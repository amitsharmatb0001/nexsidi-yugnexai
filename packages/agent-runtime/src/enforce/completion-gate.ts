// Phase 5 Task 3 (final-bundle/phase5-harness-enforcement-plan.md):
// completion is REJECTED, not discouraged, when the run has no fresh
// evidence — this is what makes Rule 6 (evidence before claims) mechanical
// rather than doctrine text a small model can skip. The while-loop (loop.ts)
// is responsible for treating a rejection as a tool result and continuing,
// not this pure module.
import type { EvidenceKind, EvidenceLedger } from "./evidence.ts";

export interface CompletionClaim {
  summary: string;
  filesWritten: string[];
  verificationPassed: boolean;
}

export type CompletionCheck = { allowed: true } | { allowed: false; reason: string };

export function checkCompletion(
  ledger: EvidenceLedger,
  claim: CompletionClaim,
  requiredVerificationCommands: string[] = [],
  // 2026-07-25 (P5.W5.4): see EvidenceLedger.hasEvidenceOfKind's comment —
  // for agents whose real proof-of-work is a tool call (http_request),
  // not a shell command, this is the equivalent of
  // requiredVerificationCommands.
  requiredEvidenceKinds: EvidenceKind[] = [],
): CompletionCheck {
  if (!claim.verificationPassed) {
    return {
      allowed: false,
      reason: "Completion rejected: verification_passed must be true after the required checks succeed.",
    };
  }
  if (!ledger.hasFreshEvidence()) {
    return {
      allowed: false,
      reason: "Completion rejected: no verification evidence this run. Run your check, read its output, then call task_complete.",
    };
  }
  const missingCommands = requiredVerificationCommands.filter(
    (command) => !ledger.hasSuccessfulCommand(command),
  );
  if (missingCommands.length > 0) {
    return {
      allowed: false,
      reason: `Completion rejected: required verification command(s) did not exit 0 this run: ${missingCommands.join(", ")}`,
    };
  }
  const missingKinds = requiredEvidenceKinds.filter((kind) => !ledger.hasEvidenceOfKind(kind));
  if (missingKinds.length > 0) {
    return {
      allowed: false,
      reason: `Completion rejected: required evidence kind(s) missing this run: ${missingKinds.join(", ")}. Call the tool that produces this evidence before claiming done.`,
    };
  }
  return { allowed: true };
}
