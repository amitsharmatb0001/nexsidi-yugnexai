import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoizeStep } from "./step-memo.ts";

// 2026-10-22 (Trailhead rerun): Arjun's planning step hit its 10-minute limit while finishing, its finished plan was thrown
// away and the whole step (including a ~4,600-token call to the strongest model) ran again: 16 of 17 planning minutes and
// the call paid twice. A step's result is now kept as soon as it exists, keyed by its exact inputs, and a retry with the
// same inputs reuses it. Different inputs (for example the owner's rejection feedback) always run the step again.

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "memo-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test("the first run saves its result and a retry with the same inputs reuses it", async () => {
  let runs = 0;
  const fn = async () => { runs++; return { plan: "p1" }; };
  expect(await memoizeStep(dir, "arjun-plan", { spec: "s", feedback: null }, fn)).toEqual({ plan: "p1" });
  expect(await memoizeStep(dir, "arjun-plan", { spec: "s", feedback: null }, fn)).toEqual({ plan: "p1" });
  expect(runs).toBe(1);
  expect(readdirSync(join(dir, ".nexsidi", "step-results")).length).toBe(1);
});

test("different inputs run the step again", async () => {
  let runs = 0;
  const fn = async () => ({ n: ++runs });
  await memoizeStep(dir, "arjun-plan", { spec: "s", feedback: null }, fn);
  expect(await memoizeStep(dir, "arjun-plan", { spec: "s", feedback: "use a darker green" }, fn)).toEqual({ n: 2 });
});

test("a failed step saves nothing, so the retry really runs", async () => {
  await expect(memoizeStep(dir, "saanvi-spec", { r: 1 }, async () => { throw new Error("model down"); })).rejects.toThrow("model down");
  expect(existsSync(join(dir, ".nexsidi", "step-results"))).toBe(false);
  expect(await memoizeStep(dir, "saanvi-spec", { r: 1 }, async () => "ok")).toBe("ok");
});

test("a build folder that does not exist yet is not created; the step still runs", async () => {
  const missing = join(dir, "not-yet");
  expect(await memoizeStep(missing, "x", {}, async () => 7)).toBe(7);
  expect(existsSync(missing)).toBe(false);
});

test("the planning steps keep their results and are limited by progress, not a 10-minute clock", async () => {
  const { readFileSync } = await import("node:fs");
  const acts = readFileSync(new URL("../../../pipeline/activities/index.ts", import.meta.url), "utf-8");
  expect(acts).toContain('memoizeStep(buildDirFor(projectId), "arjun-plan"');
  expect(acts).toContain('memoizeStep(buildDirFor(projectId), "saanvi-spec"');
  const wf = readFileSync(new URL("../../../pipeline/workflows/project-build.ts", import.meta.url), "utf-8");
  expect(wf).toContain("planAct.runSaanvi(");
  expect(wf).toContain("planAct.runArjun(");
});
