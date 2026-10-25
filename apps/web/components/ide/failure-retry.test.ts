import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { isRetryableFailure, readableFailureReason, RETRY_NOTE } from "./IdeWorkspace.tsx";

// 2026-08-29: real gap found live (project 6c7d4358cf73). A machine-wide
// network outage took every Gemini model down simultaneously mid-generation;
// the workflow correctly paused waiting for retryStageSignal
// (escalateAndAwaitRetryDecision in project-build.ts), but nothing in this
// app ever sent that signal — the only prior fix was a hand-written one-off
// Temporal script for a single specific project. Worse, this exact card's
// hint text claimed "It can't continue from here — start a new project to
// keep going" for a failure that, once retried, resumed and continued
// generating successfully. isRetryableFailure must match
// pipeline.ts's RETRYABLE_FAILURE_REASONS exactly — both lists are hand-kept
// in sync against project-build.ts's own escalateAndAwaitRetryDecision call
// sites, so a drift here silently reopens either "button shown, request
// 409s" or "button hidden, resumable build looks abandoned."

test("resumable failures — escalateAndAwaitRetryDecision paused the workflow, retry can resume it", () => {
  for (const reason of ["budget_exceeded", "generation_failed", "stuck_state", "compile_repair_limit", "deploy_stuck", "deploy_failed", "deploy_activity_error", "guard_hold"]) {
    expect(isRetryableFailure(reason)).toBe(true);
  }
});

// 2026-08-30: 4th live occurrence of the exact "uncaught activity failure
// bypasses Stage 6's retry logic" class project-build.ts's own header
// comment already documented three times over — an orphaned/hung deploy
// call surfaced as Temporal's "Activity task timed out", which `throw err`
// propagated straight out of the workflow, discarding a project that had
// already passed QA and compile-check with zero escalation. Own test
// because it's a DIFFERENT failure than deploy_stuck/deploy_failed (those
// come from a normal {success:false} activity RETURN; this comes from the
// activity call itself throwing) even though the retry treatment is the same.
test("deploy_activity_error (an uncaught Stage 6 activity throw) is retryable, not a dead end", () => {
  expect(isRetryableFailure("deploy_activity_error")).toBe(true);
  expect(readableFailureReason("deploy_activity_error")).not.toContain("internal reason");
});

test("terminal failures — the workflow already returned, there is nothing left to signal", () => {
  for (const reason of ["clarification_exhausted", "spec_rejected_too_many_times", "change_request_failed"]) {
    expect(isRetryableFailure(reason)).toBe(false);
  }
});

test("null/unknown reasons are treated as non-retryable — never show a retry button with nothing to explain it", () => {
  expect(isRetryableFailure(null)).toBe(false);
  expect(isRetryableFailure("some_future_reason_this_code_does_not_know_about")).toBe(false);
});

test("a 'code: detail' shaped reason (Riya's failureReason convention) is matched on the code", () => {
  expect(isRetryableFailure("deploy_failed: container exited with code 1")).toBe(true);
  expect(readableFailureReason("deploy_failed: container exited with code 1")).toContain("Deployment failed");
});

test("the backend's retryable set is kept in sync — same eight reasons, no more, no fewer", () => {
  const src = require("node:fs").readFileSync(new URL("../../../api/src/routes/pipeline.ts", import.meta.url), "utf-8");
  const match = src.match(/RETRYABLE_FAILURE_REASONS = new Set\(\[([\s\S]*?)\]\)/);
  expect(match).not.toBeNull();
  const backendReasons = [...match![1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const frontendReasons = ["budget_exceeded", "generation_failed", "stuck_state", "compile_repair_limit", "deploy_stuck", "deploy_failed", "deploy_activity_error", "guard_hold"];
  expect(new Set(backendReasons)).toEqual(new Set(frontendReasons));
});

// 2026-10-24 (evidence-only rule): the hold page told the owner a deploy failure was "often a transient network or
// infrastructure issue, not a problem with the generated app itself" and that an unchecked app "may still be usable" —
// guesses, not anything the system checked. Every reason now says what happened and what Retry does.
test("no failure reason guesses at the cause", () => {
  const codes = ["budget_exceeded", "clarification_exhausted", "spec_rejected_too_many_times", "generation_failed", "stuck_state",
    "compile_repair_limit", "deploy_stuck", "deploy_failed", "change_request_failed", "deploy_verification_incomplete", "deploy_activity_error", "guard_hold"];
  for (const c of codes) {
    const text = readableFailureReason(c);
    expect({ c, guess: /\b(often|commonly|probably|likely|may still|transient|not a problem with)\b/i.test(text) }).toEqual({ c, guess: false });
  }
  expect(readableFailureReason("deploy_activity_error")).toContain("Retry");
});

// 2026-10-25 (brewline2): the hold card added its own sentence, "This is often transient (a network blip, a temporary
// quota limit)", after whatever reason was shown. It is a guess, and on that build it contradicted the reason (the checks
// had not found the same issues; a reviewer had failed). The card now says only what Retry does, and the stuck reason
// covers both ways the quality checks can stop.
test("the retry sentence says what Retry does and guesses nothing, and the stuck reason names both causes", () => {
  expect(RETRY_NOTE).toContain("resumes");
  expect({ guess: /\b(often|commonly|probably|likely|may still|transient|blip)\b/i.test(RETRY_NOTE) }).toEqual({ guess: false });
  expect(readableFailureReason("stuck_state")).toContain("reviewer");
  const card = readFileSync(new URL("./IdeWorkspace.tsx", import.meta.url), "utf-8");
  expect(card).not.toContain("This is often transient");
  expect(card).toContain("? RETRY_NOTE");
});
