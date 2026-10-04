import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

// 2026-10-04 (progress guard; Ledgerly run 4 overnight). The workflow is
// replayed by Temporal, so these check the wiring in source: a held stage
// stops and asks the developer, and automatic reruns are capped at one.
const wf = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");
const acts = readFileSync(new URL("../activities/index.ts", import.meta.url), "utf-8");
const api = readFileSync(new URL("../../apps/api/src/routes/pipeline.ts", import.meta.url), "utf-8");

test("both paid review stages hold and ask a human when the guard fires", () => {
  expect((wf.match(/isGuardHoldFailure\(err\)/g) ?? []).length).toBe(2);
  expect((wf.match(/escalateAndAwaitRetryDecision\("guard_hold"\)/g) ?? []).length).toBe(2);
});

test("both review activities turn a hold into a non-retryable failure", () => {
  expect((acts.match(/throw guardHoldFailure\(/g) ?? []).length).toBe(2);
  expect(acts).toContain('type: "GuardHold"');
  expect(acts).toContain("nonRetryable: true");
});

test("the developer's Retry is accepted for a guard hold", () => {
  expect(api).toContain('"guard_hold"');
});

test("automatic reruns are capped at one, behind their own patch marker", () => {
  expect(wf).toContain('patched("auto-retry-cap-1-v1") ? 1 : MAX_AUTO_RETRIES');
});
