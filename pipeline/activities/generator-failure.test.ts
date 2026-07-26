// P4 (live NexTech run, 2026-07-25): real bug found live — a generator
// activity (runShubham/runAanya/runPranav) threw a plain Error on
// result.success:false, which Temporal's default retry policy treats as
// retryable. genAct's retry policy (maximumAttempts: 5) blindly re-ran the
// SAME failing Shubham generation 5 times with the SAME config (Shubham had
// genuinely hit its own max-iteration ceiling — a deterministic outcome
// that an identical retry cannot fix), burning ~71 minutes and 5x the real
// Gemini API cost before the workflow finally failed with the same error it
// hit on attempt 1. Fixed by marking this failure class non-retryable via
// ApplicationFailure — this test asserts the fix is actually wired for all
// three generator activities, not just described in a comment.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");

test("generatorFailure() marks the failure non-retryable via ApplicationFailure", () => {
  expect(source).toContain("ApplicationFailure");
  expect(source).toContain('from "@temporalio/activity"');
  expect(source).toContain("nonRetryable: true");
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
