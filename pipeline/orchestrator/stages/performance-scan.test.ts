import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanBuildDirForPerformance, formatPerformanceForReviewer } from "./performance-scan.ts";

// Patent claim 9: the performance reviewer is given Big-O estimates, leak patterns, and regressions since the previous round.

let dir = "";
const put = (rel: string, text: string) => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "perfscan-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("the first round has nothing to compare with, and still lists the slow function and the leak pattern", () => {
  put("backend/src/a.ts", `const seen: string[] = [];\napp.get("/h", (req, res) => { seen.push(req.ip); });\nfunction pairs(xs: number[]) { for (const a of xs) for (const b of xs) f(a, b); }\n`);
  const r = scanBuildDirForPerformance(dir);
  expect(r.previousRounds).toBe(0);
  expect(r.regressions).toEqual([]);
  expect(r.concerns.map((c) => c.name)).toEqual(["pairs"]);
  expect(r.leakPatterns.map((p) => p.kind)).toEqual(["unbounded-collection"]);
});

test("the second round is compared with the first: a function that got worse is reported as worse than last round", () => {
  put("backend/src/a.ts", `function pairs(xs: number[]) { for (const a of xs) f(a); }\n`);
  scanBuildDirForPerformance(dir);
  put("backend/src/a.ts", `function pairs(xs: number[]) { for (const a of xs) for (const b of xs) f(a, b); }\n`);
  const r = scanBuildDirForPerformance(dir);
  expect(r.previousRounds).toBe(1);
  expect(r.regressions.map((g) => g.kind)).toEqual(["complexity"]);
  const text = formatPerformanceForReviewer(r);
  expect(text).toContain("WORSE THAN LAST ROUND");
  expect(text).toContain("O(n) to O(n²)");
});

test("looking without recording leaves the history alone", () => {
  put("backend/src/a.ts", `function f() { return 1; }\n`);
  scanBuildDirForPerformance(dir, { record: false });
  expect(existsSync(join(dir, ".nexsidi", "perf-history.json"))).toBe(false);
});

test("regressions come first, then leaks, then server functions, then page components, and the list is capped", () => {
  put("backend/src/a.ts", `function pairs(xs: number[]) { for (const a of xs) for (const b of xs) f(a, b); }\n`);
  put("frontend/app/page.tsx", `export default function Page({ items }: any) { return <ul>{items.map((a: any) => items.map((b: any) => <li>{a}{b}</li>))}</ul>; }\n`);
  const text = formatPerformanceForReviewer(scanBuildDirForPerformance(dir, { record: false }));
  expect(text.indexOf("pairs")).toBeLessThan(text.indexOf("Page"));
  expect(text).toContain("page component");
  const many = { concerns: [], leakPatterns: [], regressions: Array.from({ length: 30 }, (_, i) => ({ kind: "complexity" as const, subject: `s${i}`, after: "x", message: `m${i}` })), filesAnalysed: 1, previousRounds: 1 };
  const t = formatPerformanceForReviewer(many, 5);
  expect(t.split("\n").filter((l) => l.startsWith("- ")).length).toBe(5);
  expect(t).toContain("25 more not shown");
});

test("a clean project and a missing folder both give an empty string, so the reviewer's input is unchanged", () => {
  put("backend/src/a.ts", `function f() { return 1; }\n`);
  expect(formatPerformanceForReviewer(scanBuildDirForPerformance(dir, { record: false }))).toBe("");
  expect(formatPerformanceForReviewer(scanBuildDirForPerformance(join(dir, "nowhere")))).toBe("");
});

// 2026-10-22 (both Trailhead builds): the performance reviewer reported "no index on bookings(start_date, end_date)" and "no
// index on bookings(user_id)" while the indexes existed (one in 0000_initial.sql line 50, one in 0001_fix.sql); on the rerun
// the false repeat held the whole build. The indexes already present, read from every migration file in order, now go to
// the reviewer as facts with the other leads.
test("existing indexes are read from every migration file, in order", async () => {
  const { listExistingIndexes } = await import("./performance-scan.ts");
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "idx-"));
  try {
    mkdirSync(join(dir, "db", "migrations"), { recursive: true });
    writeFileSync(join(dir, "db", "migrations", "0000_initial.sql"),
      "CREATE TABLE bookings (id uuid PRIMARY KEY, user_id uuid);\nCREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email);\nCREATE INDEX IF NOT EXISTS bookings_user_id_idx ON bookings(user_id);\n");
    writeFileSync(join(dir, "db", "migrations", "0001_fix.sql"),
      "CREATE INDEX IF NOT EXISTS bookings_start_date_end_date_idx ON bookings (start_date, end_date);\ncreate index gear_cat on public.gear using btree (category);\n");
    const idx = listExistingIndexes(dir);
    expect(idx).toEqual([
      { table: "users", columns: "email", unique: true, file: "db/migrations/0000_initial.sql" },
      { table: "bookings", columns: "user_id", unique: false, file: "db/migrations/0000_initial.sql" },
      { table: "bookings", columns: "start_date, end_date", unique: false, file: "db/migrations/0001_fix.sql" },
      { table: "gear", columns: "category", unique: false, file: "db/migrations/0001_fix.sql" },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the existing indexes are given to the performance reviewer as facts", async () => {
  const { formatExistingIndexes } = await import("./performance-scan.ts");
  const text = formatExistingIndexes([{ table: "bookings", columns: "start_date, end_date", unique: false, file: "db/migrations/0001_fix.sql" }]);
  expect(text).toContain("bookings(start_date, end_date)");
  expect(text).toContain("0001_fix.sql");
  expect(text).toContain("do not report");
  expect(formatExistingIndexes([])).toBe("");
  const stage = (await import("node:fs")).readFileSync(new URL("./stage5-adversarial-qa.ts", import.meta.url), "utf-8");
  expect(stage).toContain("formatExistingIndexes(listExistingIndexes(");
});
