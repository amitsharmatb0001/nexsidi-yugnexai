import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { USER_STAGE_MESSAGES } from "../../apps/api/src/utils/stage-labels.ts";
import { internalTermsIn } from "../../packages/agent-runtime/src/customer-text.ts";

// 2026-10-29 (team plan, stage 3): the tester writes the acceptance tests right after the customer approves the plan and
// before any code is written; the builders see them; the fixed runner checks them on the running app during the live
// review and the result goes in the report. The workflow is replayed by Temporal, so the wiring is checked in source.
const wf = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");
const acts = readFileSync(new URL("../activities/index.ts", import.meta.url), "utf-8");
const stage6 = readFileSync(new URL("../orchestrator/stages/stage6-deployment.ts", import.meta.url), "utf-8");

test("the tester runs after the plan is approved and before the builders, behind a replay marker", () => {
  const approved = wf.indexOf('if (specDecision === "approved") break;');
  const tester = wf.indexOf("planAct.runAarav(projectId)");
  const generate = wf.indexOf('state.stage = "generate";');
  expect(approved).toBeGreaterThan(0);
  expect(tester).toBeGreaterThan(approved);
  expect(tester).toBeLessThan(generate);
  expect(wf.slice(approved, tester)).toContain('patched("acceptance-tests-v1")');
});

test("a budget or system-version hold at the tester asks the owner; any other failure lets the build go on", () => {
  const step = wf.slice(wf.indexOf('patched("acceptance-tests-v1")'), wf.indexOf('state.stage = "generate";'));
  expect(step).toContain('escalateAndAwaitRetryDecision("system_changed")');
  expect(step).toContain('escalateAndAwaitRetryDecision("budget_exceeded")');
  expect(step).toContain("the build goes on without them");
});

test("the customer sees a plain message for the step, with no internal words", () => {
  const msg = USER_STAGE_MESSAGES.acceptance_tests;
  expect(msg).toBeTruthy();
  expect(internalTermsIn(msg!)).toEqual([]);
});

test("the tester's step checks the budget and the system version, and reuses its tests on a retry with the same plan", () => {
  const fn = acts.slice(acts.indexOf("export async function runAarav("), acts.indexOf("export async function runAarav(") + 1_800);
  expect(fn).toContain('await assertWithinBudget(projectId, "aarav");');
  expect(fn).toContain('await assertSameSystem(projectId, "aarav");');
  expect(fn).toContain('memoizeStep(dir, "aarav-tests"');
  expect(fn).toContain("writeAcceptanceTests(");
});

test("each builder's phase task carries the acceptance tests", () => {
  const fn = acts.slice(acts.indexOf("async function runPhaseFor("), acts.indexOf("export async function runAanyaPhase("));
  expect(fn).toContain("acceptanceTestsSection(projectId, phase, builder)");
  expect(acts).toContain('acceptanceTestsForPhase(suite.tests, isTeamPass(projectId) ? "all" : phase, builder)');
});

test("the live review runs the tests with the review accounts, records the run, and leaves no test data behind", () => {
  const block = stage6.slice(stage6.indexOf("ACCEPTANCE_TESTS"), stage6.indexOf("ACCEPTANCE_TESTS") + 2_500);
  expect(block).toContain("runAcceptanceTests(");
  expect(block).toContain("recordAcceptanceRun(");
  expect(block).toContain("recordSeededRecords(");
  // 2026-10-30 (stage 5): with the reviewers run once, a failing test is a finding for its owner and stops the round
  // (stage 3 only recorded it; REVIEW_ONCE=off keeps that).
  expect(stage6).toContain("if (process.env.REVIEW_ONCE !== \"off\") failingAcceptance = acceptanceFailureFindings(run, tests);");
  expect(stage6).toContain("if (failingAcceptance.length > 0) return { pass: false, findings: failingAcceptance, specCompliance };");
  const accounts = stage6.indexOf("Role accounts ready");
  expect(accounts).toBeGreaterThan(0);
  expect(stage6.indexOf("runAcceptanceTests(")).toBeGreaterThan(accounts);
});
