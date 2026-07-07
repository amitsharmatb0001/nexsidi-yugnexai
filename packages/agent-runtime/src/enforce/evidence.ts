// Phase 5 Task 1 (final-bundle/phase5-harness-enforcement-plan.md): per-run
// evidence ledger backing Rule 6 (evidence before claims). Tool executors
// (Task 2) report into it; the completion gate (Task 3) reads it before
// allowing task_complete. consume() returns-and-clears so the NEXT
// completion claim needs FRESH evidence — same consume semantics as the
// bash verify-gate hook in nexsidi-master-workflow, but per-run and typed
// instead of a shared file.

export type EvidenceKind = "command_output" | "file_read" | "http_check";

export interface EvidenceRecord {
  kind: EvidenceKind;
  ref: string;
}

export interface EvidenceLedger {
  record(kind: EvidenceKind, ref: string): void;
  hasFreshEvidence(): boolean;
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
    consume() {
      const current = records;
      records = [];
      return current;
    },
  };
}
