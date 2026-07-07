import { test, expect } from "bun:test";
import { checkCompletion } from "./completion-gate.ts";
import { createEvidenceLedger } from "./evidence.ts";

// Phase 5 Task 3 (final-bundle/phase5-harness-enforcement-plan.md):
// task_complete is REJECTED (not discouraged) when the ledger has no fresh
// evidence — a model claiming "verification_passed: true" with zero
// successful tool calls this run is exactly the failure mode Rule 6 exists
// to prevent. The loop (not this module) is responsible for continuing
// on rejection and injecting the reason as the tool result.

const CLAIM = { summary: "Built the feature", filesWritten: ["a.ts"], verificationPassed: true };

test("rejects completion when the ledger has no evidence at all", () => {
  const ledger = createEvidenceLedger();
  const result = checkCompletion(ledger, CLAIM);
  expect(result.allowed).toBe(false);
  if (!result.allowed) {
    expect(result.reason).toBe("Completion rejected: no verification evidence this run. Run your check, read its output, then call task_complete.");
  }
});

test("allows completion when the ledger has fresh evidence", () => {
  const ledger = createEvidenceLedger();
  ledger.record("command_output", "npx tsc --noEmit -> exited 0");
  const result = checkCompletion(ledger, CLAIM);
  expect(result).toEqual({ allowed: true });
});

test("checking completion does not itself consume the ledger — that's the caller's job", () => {
  const ledger = createEvidenceLedger();
  ledger.record("command_output", "npm test -> exited 0");
  checkCompletion(ledger, CLAIM);
  expect(ledger.hasFreshEvidence()).toBe(true);
});

test("any evidence kind satisfies the gate — file_read counts same as command_output", () => {
  const ledger = createEvidenceLedger();
  ledger.record("file_read", "src/index.ts");
  expect(checkCompletion(ledger, CLAIM)).toEqual({ allowed: true });
});
