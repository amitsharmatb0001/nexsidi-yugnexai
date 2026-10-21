import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSnapshot, compareSnapshots, loadHistory, appendSnapshot, type PerfSnapshot } from "./regression.ts";

// Patent claim 9: regressions are found by comparing one iteration with the one before it.

const src = (code: string, path = "backend/src/x.ts") => ({ path, source: code });
const snap = (files: Array<{ path: string; source: string }>, extra: Partial<PerfSnapshot> = {}) => buildSnapshot(files, extra);

test("a function that was linear and is now quadratic is reported as a regression, with before and after", () => {
  const before = snap([src(`function list(xs: number[]) { for (const x of xs) work(x); }`)]);
  const after = snap([src(`function list(xs: number[]) { for (const x of xs) for (const y of xs) work(x, y); }`)]);
  const r = compareSnapshots(before, after);
  expect(r.map((x) => x.kind)).toEqual(["complexity"]);
  expect(r[0]!.before).toBe("O(n)");
  expect(r[0]!.after).toBe("O(n²)");
  expect(r[0]!.message).toContain("list");
});

test("moving a function to another line is not a change; improving it is not a regression", () => {
  const a = snap([src(`function list(xs: number[]) { for (const x of xs) for (const y of xs) work(x, y); }`)]);
  const moved = snap([src(`\n\n\nfunction list(xs: number[]) { for (const x of xs) for (const y of xs) work(x, y); }`)]);
  expect(compareSnapshots(a, moved)).toEqual([]);
  const better = snap([src(`function list(xs: number[]) { for (const x of xs) work(x); }`)]);
  expect(compareSnapshots(a, better)).toEqual([]);
});

test("a new function that is quadratic, or that calls the database once per item, is reported", () => {
  const before = snap([src(`function a() { return 1; }`)]);
  const after = snap([src(`function a() { return 1; }\nfunction slow(xs: number[]) { for (const x of xs) for (const y of xs) f(x, y); }\nasync function n1(ids: string[]) { for (const id of ids) await db.query("q", [id]); }`)]);
  expect(compareSnapshots(before, after).map((r) => `${r.kind}:${r.subject.split("::")[1]}`).sort()).toEqual(["calls-in-loop:n1", "new-slow-function:slow"]);
});

test("a leak pattern that was not there before is reported; one that was already there is not", () => {
  const leak = `const seen: string[] = [];\napp.get("/h", (req, res) => { seen.push(req.ip); });`;
  const before = snap([src(`app.get("/h", (req, res) => { res.send("ok"); });`)]);
  const after = snap([src(leak)]);
  expect(compareSnapshots(before, after).map((r) => r.kind)).toEqual(["new-leak-pattern"]);
  expect(compareSnapshots(after, snap([src(`\n${leak}`)]))).toEqual([]);
});

test("a route that got clearly slower is reported; small or noisy changes are not", () => {
  const t = (p95: number) => ({ "/items": { count: 100, errors: 0, p50: p95 / 2, p95 } });
  const base = snap([], { routeTimings: t(40) });
  expect(compareSnapshots(base, snap([], { routeTimings: t(120) })).map((r) => r.kind)).toEqual(["route-slower"]);
  expect(compareSnapshots(base, snap([], { routeTimings: t(48) }))).toEqual([]); // under 25% and under 50 ms
  expect(compareSnapshots(snap([], { routeTimings: t(4) }), snap([], { routeTimings: t(30) }))).toEqual([]); // big ratio but tiny in absolute terms
});

test("memory that began to climb is reported", () => {
  expect(compareSnapshots(snap([], { memorySlopeMbPer1000: 0.1 }), snap([], { memorySlopeMbPer1000: 6 })).map((r) => r.kind)).toEqual(["memory-slope"]);
  expect(compareSnapshots(snap([], { memorySlopeMbPer1000: 6 }), snap([], { memorySlopeMbPer1000: 6.5 }))).toEqual([]);
});

test("with nothing to compare against there are no regressions", () => {
  expect(compareSnapshots(null, snap([src(`function f(xs: number[]) { for (const a of xs) for (const b of xs) g(a, b); }`)]))).toEqual([]);
});

test("the history is kept per project, newest last, and trimmed to a limit", () => {
  const dir = mkdtempSync(join(tmpdir(), "perf-"));
  try {
    expect(loadHistory(dir)).toEqual([]);
    for (let i = 0; i < 5; i++) appendSnapshot(dir, snap([src(`function f${i}() { return ${i}; }`)]), 3);
    const h = loadHistory(dir);
    expect(h.length).toBe(3);
    expect(Object.keys(h[2]!.functions)[0]).toContain("f4");
    expect(existsSync(join(dir, ".nexsidi", "perf-history.json"))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a damaged history file is treated as empty, not as an error", () => {
  const dir = mkdtempSync(join(tmpdir(), "perf-"));
  try {
    appendSnapshot(dir, snap([]), 3);
    require("node:fs").writeFileSync(join(dir, ".nexsidi", "perf-history.json"), "{not json");
    expect(loadHistory(dir)).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
