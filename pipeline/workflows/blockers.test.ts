import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { ActivityFailure, ApplicationFailure } from "@temporalio/workflow";
import { isBlockedFailure } from "./project-build.ts";
import { internalTermsIn } from "../../packages/agent-runtime/src/customer-text.ts";

// 2026-10-30: an open blocker stops paid work. Every paid step checks for one where it checks for an open customer question;
// the workflow has it decided (../orchestrator/blockers.ts) and runs the same step again, or holds the build for a person
// when the decision is a person's. Checked in source, like the other wiring tests.
const wf = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");
const acts = readFileSync(new URL("../activities/index.ts", import.meta.url), "utf-8");
const gateReal = readFileSync(new URL("../orchestrator/acceptance-gate-real.ts", import.meta.url), "utf-8");
const loop = readFileSync(new URL("../orchestrator/stages/stage5-qa-fix-loop.ts", import.meta.url), "utf-8");
const stage6 = readFileSync(new URL("../orchestrator/stages/stage6-deployment.ts", import.meta.url), "utf-8");
const api = readFileSync(new URL("../../apps/api/src/routes/pipeline.ts", import.meta.url), "utf-8");
const web = readFileSync(new URL("../../apps/web/components/ide/IdeWorkspace.tsx", import.meta.url), "utf-8");

const failureOf = (type: string) =>
  new ActivityFailure("x", "runShubhamPhase", "1", "IN_PROGRESS" as any, "worker1", ApplicationFailure.create({ message: "x", type, nonRetryable: true }));

test("a Blocked activity failure is recognised, and nothing else is", () => {
  expect(isBlockedFailure(failureOf("Blocked"))).toBe(true);
  expect(isBlockedFailure(failureOf("CustomerQuestion"))).toBe(false);
  expect(isBlockedFailure(new Error("plain"))).toBe(false);
});

test("every place that checks for an open customer question also checks for an open blocker", () => {
  const questionChecks = (acts.match(/await assertNoOpenCustomerQuestion\(projectId\);/g) ?? []).length;
  const pairs = (acts.match(/await assertNoOpenCustomerQuestion\(projectId\);\r?\n\s*await assertNoOpenBlocker\(projectId\);/g) ?? []).length;
  expect(questionChecks).toBeGreaterThan(10);
  expect(pairs).toBe(questionChecks - 1); // the gate's one-line "waiting" check has its own blocker check
  expect(acts).toContain('if (r.status === "waiting_for_customer") { await assertNoOpenCustomerQuestion(projectId); await assertNoOpenBlocker(projectId); }');
  expect(acts).toContain('type: "Blocked"');
});

test("generation, the acceptance gate, review and deploy each have open blockers decided, then run the step again", () => {
  expect((wf.match(/if \(isBlockedFailure\(err\)\) \{\s*if \(!\(await clearBlockers\(\)\)\) return;/g) ?? []).length).toBe(4);
  const fn = wf.slice(wf.indexOf("async function clearBlockers"), wf.indexOf("async function clearBlockers") + 900);
  expect(fn).toContain("orchestratorAct.resolveBlockersActivity(projectId)");
  expect(fn).toContain('escalateAndAwaitRetryDecision("blocked")');
  expect(fn).toContain('markProjectFailed(projectId, "blocked")');
});

test("the rounds inside a step stop on an open blocker, as they do on an open question", () => {
  expect(gateReal).toContain("openQuestions: () => openCustomerQuestions(projectId).length + openBlockers(projectId).length > 0");
  expect(loop).toContain("openQuestions: () => openCustomerQuestions(projectId).length + openBlockers(projectId).length");
  expect(stage6).toContain("if (openCustomerQuestions(projectId).length + openBlockers(projectId).length > 0) {");
});

test("a build held on a blocker can be retried from the build page, with a plain reason", () => {
  expect(api).toContain('"blocked"');
  const text = web.slice(web.indexOf("  blocked:"), web.indexOf("  blocked:") + 400);
  expect(text.length).toBeGreaterThan(20);
  expect(internalTermsIn(text.split("\n")[0]!)).toEqual([]);
});
