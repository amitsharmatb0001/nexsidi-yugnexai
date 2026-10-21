import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanBuildDirForSecurity, formatScanForReviewer } from "./security-scan.ts";
import { SEED_PATTERNS, SEED_ADVISORIES } from "../../../packages/agent-runtime/src/security/pattern-scan.ts";

// Patent claim 8: the security checker is given what the pattern database finds in the generated code and its packages.

let dir = "";
const put = (rel: string, text: string) => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "secscan-"));
  put("backend/src/auth.ts", `export const s = process.env.JWT_SECRET || "default_dev_secret";\n`);
  put("backend/src/users.ts", `export const q = (id: string) => db.query("SELECT * FROM users WHERE id = " + id);\n`);
  put("backend/package.json", JSON.stringify({ dependencies: { lodash: "^4.17.15", express: "^4.21.0" } }));
  put("frontend/vendor/ui/a.ts", `el.innerHTML = x;\n`);
  put("frontend/package.json", JSON.stringify({ dependencies: { next: "^15.1.0" } }));
  put("frontend/node_modules/next/package.json", JSON.stringify({ version: "15.5.2" }));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const load = async () => ({ patterns: SEED_PATTERNS, advisories: SEED_ADVISORIES, source: "built-in" as const });

test("the generated code and its package files are scanned, and vendored code is not", async () => {
  const r = await scanBuildDirForSecurity(dir, { load });
  expect(r.patternHits.map((h) => `${h.key}:${h.file}:${h.line}`).sort()).toEqual(["secret-fallback:backend/src/auth.ts:1", "sql-string-built:backend/src/users.ts:1"]);
  expect(r.patternsUsed).toBe(SEED_PATTERNS.length);
});

test("package versions come from what is installed when node_modules has them, from the written range otherwise", async () => {
  const r = await scanBuildDirForSecurity(dir, { load });
  const pk = r.dependencyHits.map((h) => `${h.package}@${h.version}`);
  expect(pk).toContain("lodash@^4.17.15"); // not installed: the written range allows an affected version
  expect(pk.some((x) => x.startsWith("next@"))).toBe(false); // installed 15.5.2 is past the fix
  expect(pk.some((x) => x.startsWith("express@"))).toBe(false);
});

test("the text for the reviewer is capped, worst first, says these are leads to confirm, and names the line", async () => {
  const r = await scanBuildDirForSecurity(dir, { load });
  const text = formatScanForReviewer(r, 10);
  expect(text).toContain("leads");
  expect(text).toContain("backend/src/auth.ts:1");
  expect(text).toContain("CWE-798");
  expect(text).toContain("lodash");
  expect(text.indexOf("[HIGH]")).toBeGreaterThan(-1);
  const many = { ...r, patternHits: Array.from({ length: 50 }, (_, i) => ({ ...r.patternHits[0]!, line: i + 1 })) };
  expect(formatScanForReviewer(many, 5).split("\n").filter((l) => l.startsWith("- ")).length).toBe(5);
  expect(formatScanForReviewer(many, 5)).toContain("more not shown");
});

test("nothing found gives an empty string, so the reviewer's input is unchanged", () => {
  expect(formatScanForReviewer({ patternHits: [], dependencyHits: [], taintFindings: [], patternsUsed: 3, advisoriesUsed: 3, source: "built-in" })).toBe("");
});

test("a missing folder is not an error", async () => {
  const r = await scanBuildDirForSecurity(join(dir, "nowhere"), { load });
  expect(r.patternHits).toEqual([]);
});

test("untrusted request data that reaches a dangerous call is found by following it, and listed ahead of a plain pattern hit", async () => {
  put("backend/src/routes/items.ts", `app.get("/i", async (req, res) => {
  const name = req.query.name;
  const r = await db.query("SELECT * FROM items WHERE name = '" + name + "'");
  res.json(r.rows);
});
`);
  const r = await scanBuildDirForSecurity(dir, { load });
  expect(r.taintFindings.map((f) => `${f.kind}:${f.file}:${f.sink.line}`)).toEqual(["sql-injection:backend/src/routes/items.ts:3"]);
  const text = formatScanForReviewer(r, 10);
  expect(text).toContain("sql-injection (CWE-89)");
  expect(text).toContain("req.query.name (line 2)");
  const lines = text.split("\n").filter((l) => l.startsWith("- "));
  expect(lines[0]).toContain("sql-injection"); // the traced path comes first among the HIGH leads
});

test("frontend page code is not followed (no request object there); only server code is", async () => {
  put("frontend/app/page.tsx", `export default function P({ searchParams }: any) { const q = req.query.x; return db.query("a" + q); }
`);
  const r = await scanBuildDirForSecurity(dir, { load });
  expect(r.taintFindings.every((f) => !f.file.startsWith("frontend/app/page"))).toBe(true);
});
