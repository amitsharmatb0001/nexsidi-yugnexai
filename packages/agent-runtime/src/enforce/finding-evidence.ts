// 2026-07-11: real bug found live (stress-fix2-1783753726) — Navya cited a
// `queryWhere` mutation that never happened in the actual code (verified by
// hand against the real file). Root cause: the QA agents were one-shot calls
// over a dumped text blob, with no way to check their own claim before
// finalizing it — pure pattern-matching on "this shape of code usually has
// this bug", not verified tracing. This gate closes that gap: a finding that
// cites a `file` the agent never actually called read_file on is rejected,
// same "evidence before claim" discipline completion-gate.ts already applies
// to Shubham/Aanya's task_complete.

export interface FindingLike {
  file?: string;
}

export interface FindingEvidenceCheck {
  allowed: boolean;
  reason?: string;
}

export function checkFindingsEvidence(
  findings: FindingLike[],
  readFiles: ReadonlySet<string>,
): FindingEvidenceCheck {
  const unverified = findings
    .filter((f): f is FindingLike & { file: string } => typeof f.file === "string" && f.file.length > 0)
    .filter((f) => !readFiles.has(f.file));

  if (unverified.length > 0) {
    const files = [...new Set(unverified.map((f) => f.file))];
    return {
      allowed: false,
      reason: `${unverified.length} finding(s) cite a file you never called read_file on: ${files.join(", ")}. Call read_file on each cited file to verify the claim before submitting, or drop the finding if it doesn't hold up.`,
    };
  }

  return { allowed: true };
}

// 2026-07-11: real bug found live — a smoke test of the new QA loop read
// exactly ONE file out of ~15 listed, then submitted an empty findings
// array. checkFindingsEvidence (above) only stops a finding from citing a
// file never read — it does nothing to stop a review that barely looked at
// anything from confidently declaring "clean".
//
// 2026-07-26 (agent-autonomy-assessment root-cause): the original fix here
// was a flat MIN_FILES_READ = 5, never scaled to codebase size. At real
// scale (complex1, 84 reviewable files) that let a review conclude after
// 6% coverage — confirmed live: a CRITICAL privilege-escalation bug sat
// unreviewed for 3 full QA rounds because nobody had opened the file yet,
// not because it was hard to find. Checked Claude Code's and Codex's own
// real system prompts: neither uses a numeric read-count floor. Claude
// Code's own code-review skill bounds scope (the diff) and then requires
// COMPLETE reading within that bound, never a percentage sample of
// everything. list_files' own manifest is the equivalent bound here — so
// the correct requirement is "read all of it," not "read a fraction of it."
export interface ReviewCoverageCheck {
  allowed: boolean;
  reason?: string;
}

export function checkReviewCoverage(filesReadCount: number, totalFilesListed: number): ReviewCoverageCheck {
  if (filesReadCount < totalFilesListed) {
    return {
      allowed: false,
      reason: `You've only read ${filesReadCount} of ${totalFilesListed} files — read every listed file before submitting findings. A review that hasn't looked at a file cannot conclude that file is clean.`,
    };
  }
  return { allowed: true };
}

// Token-waste-reduction plan, Task 1 (2026-08-16): round-scoped re-review.
// checkReviewCoverage (above) is the round-1 gate — "read literally every
// file in the project" — and stays completely unchanged for round 1. This is
// the round-2+ gate: instead of requiring every file in the whole project,
// it requires every file that actually CHANGED since the last round (from
// Shubham/Aanya/Pranav's own filesWritten, threaded in by
// stage5-qa-fix-loop.ts — see qa-loop.ts's changedFilesSinceLastRound). A
// reviewer is still free to read MORE than the changed set (e.g. an
// unchanged file whose correctness depends on a changed one) — this only
// stops it from submitting with LESS than the changed set unread, the same
// "must have actually looked before concluding" discipline
// checkReviewCoverage already enforces, just scoped to what could plausibly
// have moved instead of the whole codebase.
export function checkChangedFilesCoverage(readFiles: ReadonlySet<string>, changedFiles: string[]): ReviewCoverageCheck {
  const unread = changedFiles.filter((f) => !readFiles.has(f));
  if (unread.length > 0) {
    return {
      allowed: false,
      reason: `You still need to read ${unread.length} of ${changedFiles.length} file(s) that changed since your last review before submitting: ${unread.join(", ")}. These are the files most likely to hold a new or still-unfixed issue.`,
    };
  }
  return { allowed: true };
}
