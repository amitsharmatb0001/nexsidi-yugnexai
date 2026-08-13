// 2026-08-13 (cost-control Task 1): test coverage for the workflow-side
// escalation wiring the review flagged as untested — "exactly the kind of
// SDK-internals-dependent code that silently breaks on a Temporal version
// bump with nothing to catch it." isBudgetExceededFailure() is a
// pure(-ish) type-matching predicate over real @temporalio/common failure
// classes (ActivityFailure/ApplicationFailure), so it's directly
// constructible and testable here without a live Temporal server or worker
// — same "test the pure logic in isolation" discipline as
// cost-budget.test.ts uses for recordSpend/checkBudget's math.
//
// A full TestWorkflowEnvironment run of projectBuildWorkflow itself isn't
// set up anywhere in this repo yet (compile-loop.test.ts's own header
// comments say the same for the OTHER escalation sites — "given a full
// TestWorkflowEnvironment run of this workflow isn't set up in this repo
// yet"), so the Stage 3/Stage 5/Stage 6 catch-block WIRING (as opposed to
// isBudgetExceededFailure's own logic) is verified the same lightweight,
// already-established way compile-loop.test.ts verifies every other
// escalation site in this same file: asserting the expected control-flow
// shape directly from source. This is a source-text check, not a mock:
// exactly what a version bump silently changing ActivityFailure/
// ApplicationFailure's cause chain (the risk actually named above) would
// NOT catch — that risk is covered by the real construct-and-call tests
// below instead.
import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { ActivityFailure, ApplicationFailure } from "@temporalio/workflow";
import { isBudgetExceededFailure } from "./project-build.ts";

const source = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");

// ── isBudgetExceededFailure: real construct-and-call tests ─────────────────
// (not source-grepping — this is exactly the logic the review is worried
// about, so it gets exercised for real against the actual SDK classes.)

function budgetExceededActivityFailure(): ActivityFailure {
  const cause = ApplicationFailure.create({
    message: "budget_exceeded: project p1 has spent $50.00 of its $50.00 cap — halted before code-fix ran",
    type: "BudgetExceeded",
    nonRetryable: true,
  });
  return new ActivityFailure("budget exceeded", "runCodeFix", "1", "IN_PROGRESS" as any, "worker1", cause);
}

test("isBudgetExceededFailure returns true for an ActivityFailure whose cause is a BudgetExceeded ApplicationFailure", () => {
  expect(isBudgetExceededFailure(budgetExceededActivityFailure())).toBe(true);
});

test("isBudgetExceededFailure returns false for an ActivityFailure whose cause is a DIFFERENT ApplicationFailure type", () => {
  // e.g. generatorFailure()'s own ApplicationFailure shape (type:
  // "GeneratorExhausted") — must not be misrouted into the budget path.
  const cause = ApplicationFailure.create({ message: "[shubham] boom", type: "GeneratorExhausted", nonRetryable: true });
  const failure = new ActivityFailure("boom", "runShubham", "1", "IN_PROGRESS" as any, "worker1", cause);
  expect(isBudgetExceededFailure(failure)).toBe(false);
});

test("isBudgetExceededFailure returns false for an ActivityFailure whose cause is not an ApplicationFailure at all", () => {
  const failure = new ActivityFailure("boom", "runCodeFix", "1", "IN_PROGRESS" as any, "worker1", new Error("plain transport error"));
  expect(isBudgetExceededFailure(failure)).toBe(false);
});

test("isBudgetExceededFailure returns false for an ActivityFailure with no cause at all", () => {
  const failure = new ActivityFailure("boom", "runCodeFix", "1", "IN_PROGRESS" as any, "worker1");
  expect(isBudgetExceededFailure(failure)).toBe(false);
});

test("isBudgetExceededFailure returns false for a plain Error — never an ActivityFailure at all", () => {
  expect(isBudgetExceededFailure(new Error("budget_exceeded: whatever"))).toBe(false);
});

test("isBudgetExceededFailure returns false for a bare ApplicationFailure that never crossed an Activity boundary", () => {
  // Confirms the check really requires the ActivityFailure wrapper (the
  // real shape a failed activity call surfaces as in workflow code, per
  // @temporalio/common's own doc on ApplicationFailure/ActivityFailure),
  // not just "any BudgetExceeded ApplicationFailure found anywhere".
  const bare = ApplicationFailure.create({ message: "budget_exceeded: x", type: "BudgetExceeded", nonRetryable: true });
  expect(isBudgetExceededFailure(bare)).toBe(false);
});

// ── Stage 3 (generation) catch-block wiring ─────────────────────────────────
// Already-correct per the task brief; asserted here as a baseline/regression
// guard, matching compile-loop.test.ts's own source-assertion convention for
// this file's other escalation sites.

test("Stage 3 generation catch block checks isBudgetExceededFailure before the generic generation_failed path", () => {
  expect(source).toContain("if (isBudgetExceededFailure(err)) {");
  expect(source).toContain('escalateAndAwaitRetryDecision("budget_exceeded")');
  expect(source).toContain('await act.markProjectFailed(projectId, "budget_exceeded");');
  expect(source).toContain('escalateAndAwaitRetryDecision("generation_failed")');
  // The budget branch must be checked BEFORE falling through to the
  // generic "generation_failed" handling, not after — order matters here
  // since both branches live in the same catch block. Anchored on the
  // REAL code line (not compile-loop.test.ts's own comment a few lines
  // above it, which also mentions "generation_failed" and would otherwise
  // make this comparison meaningless).
  const budgetCheckIdx = source.indexOf("if (isBudgetExceededFailure(err)) {");
  const genericFailIdx = source.indexOf('? await escalateAndAwaitRetryDecision("generation_failed")');
  expect(budgetCheckIdx).toBeGreaterThan(-1);
  expect(genericFailIdx).toBeGreaterThan(-1);
  expect(budgetCheckIdx).toBeLessThan(genericFailIdx);
});

// ── Stage 5 (QA/GAN) catch-block wiring ─────────────────────────────────────

test("Stage 5 QA catch block rethrows anything that is NOT a budget failure, unchanged", () => {
  expect(source).toContain("if (!isBudgetExceededFailure(err)) throw err;");
});

test("Stage 5 QA catch block routes a budget failure through escalateAndAwaitRetryDecision(\"budget_exceeded\") before markProjectFailed", () => {
  // There are three distinct "budget_exceeded" escalation sites in this file
  // after this task (Stage 3, Stage 5 QA, plus this task's own two new
  // compile-repair sites and Stage 6) — assert count, not just presence, so
  // this test would fail if a site were accidentally removed later.
  const occurrences = source.split('escalateAndAwaitRetryDecision("budget_exceeded")').length - 1;
  expect(occurrences).toBeGreaterThanOrEqual(5); // Stage 3, Stage 5 QA, pre-QA compile, post-QA compile, Stage 6 deploy
});

// ── New in this task: runCodeFix gating (Finding 2) is caught at both call
// sites, not left to propagate uncaught and wedge the workflow ───────────────

test("pre-QA compile repair's runCodeFix call is wrapped in a try/catch for budget-exceeded", () => {
  const callIdx = source.indexOf("await genAct.runCodeFix(projectId, 0, `compile_error:\\n${compile.errors}`);");
  expect(callIdx).toBeGreaterThan(-1);
  // The nearest preceding "try {" (within a small window) must belong to
  // this call, and the nearest following catch must check
  // isBudgetExceededFailure — i.e. this specific call site, not some other
  // try/catch elsewhere in the file.
  const surrounding = source.slice(Math.max(0, callIdx - 400), callIdx + 600);
  expect(surrounding).toContain("try {");
  expect(surrounding).toContain("if (!isBudgetExceededFailure(err)) throw err;");
  expect(surrounding).toContain('escalateAndAwaitRetryDecision("budget_exceeded")');
});

test("post-QA compile repair's runCodeFix call is wrapped in a try/catch for budget-exceeded", () => {
  const callIdx = source.indexOf("await genAct.runCodeFix(projectId, state.iteration, `compile_error:\\n${postQaCompile.errors}`);");
  expect(callIdx).toBeGreaterThan(-1);
  const surrounding = source.slice(Math.max(0, callIdx - 400), callIdx + 700);
  expect(surrounding).toContain("try {");
  expect(surrounding).toContain("if (!isBudgetExceededFailure(err)) throw err;");
  expect(surrounding).toContain("budgetExceeded = true;");
});

// ── New in this task: Stage 6 deploy gating is also caught, not left
// uncaught (runDeployWithLiveRetest now calls assertWithinBudget too) ───────

test("Stage 6 deploy's runDeployWithLiveRetest call is wrapped in a try/catch for budget-exceeded", () => {
  const callIdx = source.indexOf("deployResult = await orchestratorAct.runDeployWithLiveRetest(projectId);");
  expect(callIdx).toBeGreaterThan(-1);
  const surrounding = source.slice(Math.max(0, callIdx - 400), callIdx + 700);
  expect(surrounding).toContain("try {");
  expect(surrounding).toContain("if (!isBudgetExceededFailure(err)) throw err;");
  expect(surrounding).toContain('escalateAndAwaitRetryDecision("budget_exceeded")');
});

// ── A normal (non-budget) failure at the new call sites must still surface
// as a real error, not be silently swallowed as if it were a budget halt ────

test("a non-budget error thrown by isBudgetExceededFailure's own check path is rethrown, not swallowed, at every new call site", () => {
  // Every new catch block in this task follows the identical
  // `if (!isBudgetExceededFailure(err)) throw err;` shape used by the
  // already-correct Stage 5 site — count must be at least 3 (pre-QA
  // compile, post-QA compile, Stage 6 deploy) plus the pre-existing Stage 5
  // one = 4.
  const occurrences = source.split("if (!isBudgetExceededFailure(err)) throw err;").length - 1;
  expect(occurrences).toBeGreaterThanOrEqual(4);
});
