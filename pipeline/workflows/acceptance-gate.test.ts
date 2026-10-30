import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { USER_STAGE_MESSAGES } from "../../apps/api/src/utils/stage-labels.ts";
import { internalTermsIn } from "../../packages/agent-runtime/src/customer-text.ts";

// 2026-10-30 (team plan, stage 4): after the build and its compile gate, and before the adversarial review, the build must
// pass its acceptance tests on the running app. A gate that stops making progress holds the build for a person; Retry
// runs more rounds. The workflow is replayed by Temporal, so the wiring is checked in source.
const wf = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");
const acts = readFileSync(new URL("../activities/index.ts", import.meta.url), "utf-8");
const api = readFileSync(new URL("../../apps/api/src/routes/pipeline.ts", import.meta.url), "utf-8");
const web = readFileSync(new URL("../../apps/web/components/ide/IdeWorkspace.tsx", import.meta.url), "utf-8");
const stage6 = readFileSync(new URL("../orchestrator/stages/stage6-deployment.ts", import.meta.url), "utf-8");
const gen = { shubham: readFileSync(new URL("../../agents/generators/shubham/src/index.ts", import.meta.url), "utf-8"), aanya: readFileSync(new URL("../../agents/generators/aanya/src/index.ts", import.meta.url), "utf-8") };

test("the gate runs after the compile gate and before the review, behind a replay marker", () => {
  const compile = wf.indexOf('state.stage = "compile_check";');
  const gate = wf.indexOf("orchestratorAct.runAcceptanceGateActivity(projectId)");
  const review = wf.indexOf('patched("unify-real-gan-and-deploy-v1")');
  expect(compile).toBeGreaterThan(0);
  expect(gate).toBeGreaterThan(compile);
  expect(gate).toBeLessThan(review);
  expect(wf.slice(compile, gate)).toContain('patched("acceptance-gate-v1")');
});

test("a gate still failing holds the build; budget, system change and a customer question are handled like every paid step", () => {
  const step = wf.slice(wf.indexOf('patched("acceptance-gate-v1")'), wf.indexOf('patched("unify-real-gan-and-deploy-v1")'));
  expect(step).toContain('escalateAndAwaitRetryDecision("acceptance_failing")');
  expect(step).toContain('markProjectFailed(projectId, "acceptance_failing")');
  expect(step).toContain("isCustomerQuestionFailure(err)");
  expect(step).toContain('escalateAndAwaitRetryDecision("system_changed")');
  expect(step).toContain('escalateAndAwaitRetryDecision("budget_exceeded")');
});

test("the customer sees a plain message for the step, with no internal words", () => {
  expect(internalTermsIn(USER_STAGE_MESSAGES.acceptance!)).toEqual([]);
});

test("a held gate can be retried from the build page, with a plain reason", () => {
  expect(api).toContain('"acceptance_failing"');
  expect(web).toContain("acceptance_failing:");
  const text = web.slice(web.indexOf("acceptance_failing:"), web.indexOf("acceptance_failing:") + 400);
  expect(internalTermsIn(text)).toEqual([]);
});

test("the activity checks budget, system version and open questions before it starts and before every round", () => {
  const fn = acts.slice(acts.indexOf("export async function runAcceptanceGateActivity("), acts.indexOf("export async function runAcceptanceGateActivity(") + 2_000);
  expect((fn.match(/await assertWithinBudget\(projectId, "acceptance-gate"\);/g) ?? []).length).toBe(2);
  expect((fn.match(/await assertNoOpenCustomerQuestion\(projectId\);/g) ?? []).length).toBeGreaterThanOrEqual(2);
  expect(fn).toContain("runAcceptanceGate(");
  expect(fn).toContain("cleanup()");
});

test("the builders' fix runs take the gate's finish check", () => {
  for (const src of [gen.shubham, gen.aanya]) {
    expect(src).toContain("extra?: { exitChecks?: () => Promise<string[]> }");
    expect(src).toContain("withExtraChecks(");
  }
});

test("the final review runs only the tests that still count", () => {
  expect(stage6).toContain("activeTests(readAcceptanceTests(buildDirFor(projectId)))");
});
