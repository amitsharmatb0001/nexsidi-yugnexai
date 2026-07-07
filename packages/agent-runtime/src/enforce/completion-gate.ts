// Phase 5 Task 3 (final-bundle/phase5-harness-enforcement-plan.md):
// completion is REJECTED, not discouraged, when the run has no fresh
// evidence — this is what makes Rule 6 (evidence before claims) mechanical
// rather than doctrine text a small model can skip. The while-loop (loop.ts)
// is responsible for treating a rejection as a tool result and continuing,
// not this pure module.
import type { EvidenceLedger } from "./evidence.ts";

export interface CompletionClaim {
  summary: string;
  filesWritten: string[];
  verificationPassed: boolean;
}

export type CompletionCheck = { allowed: true } | { allowed: false; reason: string };

export function checkCompletion(ledger: EvidenceLedger, _claim: CompletionClaim): CompletionCheck {
  if (!ledger.hasFreshEvidence()) {
    return {
      allowed: false,
      reason: "Completion rejected: no verification evidence this run. Run your check, read its output, then call task_complete.",
    };
  }
  return { allowed: true };
}
