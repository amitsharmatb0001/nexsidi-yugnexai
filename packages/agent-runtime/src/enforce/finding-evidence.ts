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
// anything from confidently declaring "clean". This requires a minimum
// spread of files read before a review can conclude, scaled down for small
// projects so the bar is never impossible to clear.
const MIN_FILES_READ = 5;

export interface ReviewCoverageCheck {
  allowed: boolean;
  reason?: string;
}

export function checkReviewCoverage(filesReadCount: number, totalFilesListed: number): ReviewCoverageCheck {
  const required = Math.min(MIN_FILES_READ, totalFilesListed);
  if (filesReadCount < required) {
    return {
      allowed: false,
      reason: `You've only read ${filesReadCount} of ${totalFilesListed} files — read at least ${required} before submitting findings. A thorough review can't conclude from reading a handful of files.`,
    };
  }
  return { allowed: true };
}
