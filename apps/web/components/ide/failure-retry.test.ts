import { test, expect } from "bun:test";
import { isRetryableFailure, readableFailureReason } from "./IdeWorkspace.tsx";

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
  for (const reason of ["budget_exceeded", "generation_failed", "stuck_state", "compile_repair_limit", "deploy_stuck", "deploy_failed"]) {
    expect(isRetryableFailure(reason)).toBe(true);
  }
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

test("the backend's retryable set is kept in sync — same six reasons, no more, no fewer", () => {
  const src = require("node:fs").readFileSync(new URL("../../../api/src/routes/pipeline.ts", import.meta.url), "utf-8");
  const match = src.match(/RETRYABLE_FAILURE_REASONS = new Set\(\[([\s\S]*?)\]\)/);
  expect(match).not.toBeNull();
  const backendReasons = [...match![1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const frontendReasons = ["budget_exceeded", "generation_failed", "stuck_state", "compile_repair_limit", "deploy_stuck", "deploy_failed"];
  expect(new Set(backendReasons)).toEqual(new Set(frontendReasons));
});
