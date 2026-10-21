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
