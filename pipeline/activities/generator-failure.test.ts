// P4 (live NexTech run, 2026-07-25): real bug found live — a generator
// activity (runShubham/runAanya/runPranav) threw a plain Error on
// result.success:false, which Temporal's default retry policy treats as
// retryable. genAct's retry policy (maximumAttempts: 5) blindly re-ran the
// SAME failing Shubham generation 5 times with the SAME config (Shubham had
// genuinely hit its own max-iteration ceiling — a deterministic outcome
// that an identical retry cannot fix), burning ~71 minutes and 5x the real
// Gemini API cost before the workflow finally failed with the same error it
// hit on attempt 1. Fixed by marking this failure class non-retryable via
// ApplicationFailure.
//
// 2026-08-05 (live, d709f34a800e): that blanket nonRetryable:true was ITSELF
// a real bug for a different failure shape — a transient full-pool Gemini
// quota exhaustion (isQuotaExhaustionError) killed the entire workflow
// instantly instead of giving Temporal's retry policy a chance, losing
// Shubham's and Pranav's already-completed work too. generatorFailure now
// only marks nonRetryable when the failure is NOT quota-shaped — the
// original deterministic-failure case (a genuine max-iteration ceiling)
// still gets nonRetryable:true, preserving the original fix's intent exactly.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ApplicationFailure } from "@temporalio/activity";
import { generatorFailure } from "./index.ts";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");

test("generatorFailure() throws an ApplicationFailure, nonRetryable, for a genuine deterministic failure", () => {
  try {
    generatorFailure("shubham", ["Agent stopped calling tools for 5 turns without calling task_complete"]);
    throw new Error("generatorFailure did not throw");
  } catch (err) {
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect((err as ApplicationFailure).nonRetryable).toBe(true);
  }
});

test("generatorFailure() throws an ApplicationFailure, RETRYABLE, for a quota-exhaustion failure", () => {
  try {
    generatorFailure("aanya", [
      "Gemini call failed on iteration 9 — every model in the pool is circuit-broken, aborting early instead of grinding to MAX_ITERATIONS on a call that cannot succeed as-is: all pool models exhausted",
    ]);
    throw new Error("generatorFailure did not throw");
  } catch (err) {
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect((err as ApplicationFailure).nonRetryable).toBe(false);
  }
});

test("runShubham, runAanya, and runPranav all route their failure case through generatorFailure(), not a plain throw", () => {
  for (const agent of ["shubham", "aanya", "pranav"]) {
    expect(source).toContain(`generatorFailure("${agent}", result.errors)`);
  }
  // The old pattern must be fully gone, not just supplemented — a
  // leftover plain throw on any of these three would silently keep the
  // retry-storm bug alive for that one agent.
  expect(source).not.toContain('throw new Error(`[shubham]');
  expect(source).not.toContain('throw new Error(`[aanya]');
  expect(source).not.toContain('throw new Error(`[pranav]');
});

test("runShubham, runAanya, and runPranav all route their generator call through runGeneratorWithQuotaRetry", () => {
  expect(source).toContain('runGeneratorWithQuotaRetry(() => runShubhamAgent(plan))');
  expect(source).toContain('runGeneratorWithQuotaRetry(() => runAanyaAgent(plan, "integrate"))');
  expect(source).toContain('runGeneratorWithQuotaRetry(() => runPranavAgent(plan))');
});
