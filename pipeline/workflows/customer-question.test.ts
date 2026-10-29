import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { ActivityFailure, ApplicationFailure } from "@temporalio/workflow";
import { isCustomerQuestionFailure } from "./project-build.ts";

// 2026-10-29 (team plan, stage 2): a builder's question that the approved documents do not answer pauses the build;
// the customer is asked in plain words, the answer is recorded for every agent, and the same step runs again. The
// workflow is replayed by Temporal, so the wiring is checked in source, like guard-hold.test.ts.
const wf = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");
const acts = readFileSync(new URL("../activities/index.ts", import.meta.url), "utf-8");

const failureOf = (type: string) =>
  new ActivityFailure("x", "runShubhamPhase", "1", "IN_PROGRESS" as any, "worker1", ApplicationFailure.create({ message: "x", type, nonRetryable: true }));

test("a CustomerQuestion activity failure is recognised, and nothing else is", () => {
  expect(isCustomerQuestionFailure(failureOf("CustomerQuestion"))).toBe(true);
  expect(isCustomerQuestionFailure(failureOf("SystemChanged"))).toBe(false);
  expect(isCustomerQuestionFailure(new Error("plain"))).toBe(false);
});

test("generation, review and deploy each ask the customer and then run the same step again", () => {
  expect((wf.match(/if \(isCustomerQuestionFailure\(err\)\) \{\s*await askTheCustomer\(\);/g) ?? []).length).toBe(3);
});

test("each open question is asked in the customer's words and its answer is recorded", () => {
  const fn = wf.slice(wf.indexOf("async function askTheCustomer"), wf.indexOf("async function askTheCustomer") + 900);
  expect(fn).toContain("act.openCustomerQuestionsActivity(projectId)");
  expect(fn).toContain("askAndWait([q.forCustomer])");
  expect(fn).toContain("act.recordCustomerAnswerActivity(projectId, q.id, answer)");
  expect(fn).toContain('state.stage = "awaiting_customer"');
});

test("every paid step checks for an open question where it checks the system version", () => {
  // The tester (stage 3) runs before any builder, so no builder's question can be open there yet.
  const sites = [...acts.matchAll(/await assertSameSystem\(projectId, (.+?)\);\r?\n\s*(.*)/g)].filter((m) => m[1] !== '"aarav"');
  expect(sites.length).toBe(8);
  for (const m of sites) expect(m[2]).toBe("await assertNoOpenCustomerQuestion(projectId);");
});

test("a builder's question stops its step before the step counts as done", () => {
  for (const name of ["runShubham", "runAanya", "runPranav"]) {
    const body = acts.slice(acts.indexOf(`export async function ${name}(`), acts.indexOf(`export async function ${name}(`) + 1_200);
    const run = body.indexOf("generatorFailure(");
    expect(body.indexOf("assertNoOpenCustomerQuestion(projectId)", run)).toBeGreaterThan(run);
  }
  const phase = acts.slice(acts.indexOf("async function runPhaseFor("), acts.indexOf("export async function runAanyaPhase("));
  const wrapper = phase.slice(phase.indexOf("runAgent: async"), phase.indexOf("reportBlocked:"));
  expect(wrapper).toContain("assertNoOpenCustomerQuestion(projectId)");
  expect(phase).toContain("if (isCustomerQuestionError(err)) throw err;");
});

test("an open question leaves the activity as a non-retryable CustomerQuestion failure", () => {
  const fn = acts.slice(acts.indexOf("export async function assertNoOpenCustomerQuestion("));
  expect(fn.slice(0, 700)).toContain('type: "CustomerQuestion"');
  expect(fn.slice(0, 700)).toContain("nonRetryable: true");
  expect(acts).toContain("export async function openCustomerQuestionsActivity(");
  expect(acts).toContain("export async function recordCustomerAnswerActivity(");
});
