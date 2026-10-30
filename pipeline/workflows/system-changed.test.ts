import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { ActivityFailure, ApplicationFailure } from "@temporalio/workflow";
import { isSystemChangedFailure } from "./project-build.ts";

// Stage 0 of the team plan (2026-10-29): a build is a test of one system version. A change while it runs holds the
// build with its own reason; the owner's Retry continues on the changed system. The workflow is replayed by
// Temporal, so the wiring is checked in source, like guard-hold.test.ts.
const wf = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");
const acts = readFileSync(new URL("../activities/index.ts", import.meta.url), "utf-8");
const api = readFileSync(new URL("../../apps/api/src/routes/pipeline.ts", import.meta.url), "utf-8");
const web = readFileSync(new URL("../../apps/web/components/ide/IdeWorkspace.tsx", import.meta.url), "utf-8");

const failureOf = (type: string) =>
  new ActivityFailure("x", "runQAFixLoopActivity", "1", "IN_PROGRESS" as any, "worker1", ApplicationFailure.create({ message: "x", type, nonRetryable: true }));

test("a SystemChanged activity failure is recognised", () => {
  expect(isSystemChangedFailure(failureOf("SystemChanged"))).toBe(true);
});

test("other failures are not taken for a system change", () => {
  expect(isSystemChangedFailure(failureOf("GuardHold"))).toBe(false);
  expect(isSystemChangedFailure(failureOf("BudgetExceeded"))).toBe(false);
  expect(isSystemChangedFailure(new Error("plain"))).toBe(false);
});

// 2026-10-29 (team plan, stage 3): the tester's step is the fourth; 2026-10-30 (stage 4): the acceptance gate the fifth.
test("the tester, generation, the acceptance gate, review and deploy each hold and ask the owner on a system change", () => {
  expect((wf.match(/isSystemChangedFailure\(err\)/g) ?? []).length).toBe(5);
  expect((wf.match(/escalateAndAwaitRetryDecision\("system_changed"\)/g) ?? []).length).toBe(5);
  expect((wf.match(/markProjectFailed\(projectId, "system_changed"\)/g) ?? []).length).toBe(5);
});

test("the build's starting version is stamped when the spec step runs", () => {
  const saanvi = acts.slice(acts.indexOf("export async function runSaanvi("), acts.indexOf("export async function runSaanvi(") + 2_000);
  expect(saanvi).toContain("stampSystemVersion(");
});

test("every paid stage that checks the budget also checks the system version, except the compile repair", () => {
  const budgetSteps = [...acts.matchAll(/await assertWithinBudget\(projectId, (.+?)\);\r?\n\s*(.*)/g)];
  const checked = budgetSteps.filter((m) => !m[1]!.includes("code-fix"));
  expect(checked.length).toBe(11); // 2026-10-30: the acceptance gate checks at its start and before every round
  for (const m of checked) expect(m[2]).toBe(`await assertSameSystem(projectId, ${m[1]});`);
});

test("a system change leaves the activity as a non-retryable SystemChanged failure", () => {
  expect(acts).toContain('type: "SystemChanged"');
  const fn = acts.slice(acts.indexOf("export async function assertSameSystem("));
  expect(fn.slice(0, 900)).toContain("nonRetryable: true");
});

test("the owner's Retry is accepted for a system change and records the new version", () => {
  expect(api).toContain('"system_changed"');
  const retry = api.slice(api.indexOf('pipelineRouter.post("/:projectId/retry"'));
  expect(retry.indexOf("acceptPendingSystemVersion(")).toBeGreaterThan(-1);
  expect(retry.indexOf("acceptPendingSystemVersion(")).toBeLessThan(retry.indexOf('sendWorkflowSignal(projectId, "retryStageSignal"'));
});

test("the hold card explains a system change and offers Retry", () => {
  expect(web).toMatch(/system_changed: "[^"]*changed while this build was running/);
  const retryable = web.slice(web.indexOf('return ["budget_exceeded"'), web.indexOf('return ["budget_exceeded"') + 300);
  expect(retryable).toContain('"system_changed"');
});
