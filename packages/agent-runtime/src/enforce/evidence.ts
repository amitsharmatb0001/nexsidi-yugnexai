// Phase 5 Task 1 (final-bundle/phase5-harness-enforcement-plan.md): per-run
// evidence ledger backing Rule 6 (evidence before claims). Tool executors
// (Task 2) report into it; the completion gate (Task 3) reads it before
// allowing task_complete. consume() returns-and-clears so the NEXT
// completion claim needs FRESH evidence — same consume semantics as the
// bash verify-gate hook in nexsidi-master-workflow, but per-run and typed
// instead of a shared file.

// 2026-08-10: "visual_check" added — real gap found live (user request): a
// generator with screenshot/browser tools enabled could claim task_complete
// having never actually looked at a rendered page, same class of hole
// "http_check" closed for "claims done with zero live verification." See
// tools/screenshot.ts and tools/browser.ts's browser_screenshot for where
// this gets recorded.
export type EvidenceKind = "command_output" | "file_read" | "http_check" | "visual_check";

export interface EvidenceRecord {
  kind: EvidenceKind;
  ref: string;
}

export interface EvidenceLedger {
  record(kind: EvidenceKind, ref: string): void;
  hasFreshEvidence(): boolean;
  hasSuccessfulCommand(command: string): boolean;
  // 2026-07-25 (P5.W5.4): "any evidence kind" (hasFreshEvidence) is too
  // permissive for an agent whose real proof-of-work isn't a shell command
  // at all — Riya's tools are docker_compose/http_request, so
  // requiredVerificationCommands (exact command-string matching) can't
  // express "you must have called http_request successfully" for it. This
  // lets a caller require a specific evidence KIND regardless of which
  // exact tool call produced it.
  hasEvidenceOfKind(kind: EvidenceKind): boolean;
  // 2026-08-10: "was this kind seen at all" is satisfied by ONE call — the
  // right bar for "did you verify at all," too weak for "did you verify
  // BREADTH" (e.g. every resource's CRUD, not just one endpoint). Lets a
  // caller require a minimum COUNT, not just presence.
  countOfKind(kind: EvidenceKind): number;
  consume(): EvidenceRecord[];
}

export function createEvidenceLedger(): EvidenceLedger {
  let records: EvidenceRecord[] = [];

  return {
    record(kind, ref) {
      records.push({ kind, ref });
    },
    hasFreshEvidence() {
      return records.length > 0;
    },
    hasSuccessfulCommand(command) {
      const required = command.trim().replace(/\s+/g, " ");
      return records.some((record) => {
        if (record.kind !== "command_output") return false;
        const ref = record.ref.trim().replace(/\s+/g, " ");
        return (
          ref === `${required} -> exited 0` ||
          (ref.startsWith(`${required} `) && ref.endsWith(" -> exited 0"))
        );
      });
    },
    hasEvidenceOfKind(kind) {
      return records.some((record) => record.kind === kind);
    },
    countOfKind(kind) {
      return records.filter((record) => record.kind === kind).length;
    },
    consume() {
      const current = records;
      records = [];
      return current;
    },
  };
}
