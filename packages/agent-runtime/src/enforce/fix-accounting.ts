// 2026-10-04 (evidence-only plan; Ledgerly run 4, overnight): a fix run
// checked a finding, saw the form worked, said so only in its summary, changed
// nothing and finished — no dispute was recorded, so the same finding came
// back every round and the stage looped all night. A fix run (one offered
// escalate_finding/dispute_finding) may finish only when it has done one of
// these for its findings: changed code, disputed with evidence, or handed one
// to its owner. Counted from what the run actually did, never read from text.
export function fixRunUnaccounted(done: { filesWritten: number; disputes: number; escalations: number }): string | null {
  if (done.filesWritten > 0 || done.disputes > 0 || done.escalations > 0) return null;
  return (
    "You changed nothing, disputed nothing and handed nothing on. For each finding: fix it; or, if you checked and the facts " +
    "show it is not true, call dispute_finding with what you checked and saw; or, if it belongs to another builder, call " +
    "escalate_finding. A summary alone does not settle a finding."
  );
}
