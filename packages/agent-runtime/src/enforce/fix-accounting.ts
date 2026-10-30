// 2026-10-04 (evidence-only plan; Ledgerly run 4, overnight): a fix run
// checked a finding, saw the form worked, said so only in its summary, changed
// nothing and finished — no dispute was recorded, so the same finding came
// back every round and the stage looped all night. A fix run (one offered
// escalate_finding/dispute_finding) may finish only when it has done one of
// these for its findings: changed code, disputed with evidence, or handed one
// to its owner. Counted from what the run actually did, never read from text.
// 2026-10-30 (team plan, stage 4): for acceptance tests a fix is counted by the test, not by the files written: fixed (it
// passes now), still failing, or broken (it passed before the round and fails after it).
export function testFixOutcome(
  before: Array<{ id: string; status: string }>,
  after: Array<{ id: string; status: string }>,
): { fixed: string[]; stillFailing: string[]; broken: string[] } {
  const now = new Map(after.map((r) => [r.id, r.status]));
  const out = { fixed: [] as string[], stillFailing: [] as string[], broken: [] as string[] };
  for (const r of before) {
    const s = now.get(r.id);
    if (r.status === "failed" && s === "passed") out.fixed.push(r.id);
    else if (r.status === "failed" && s === "failed") out.stillFailing.push(r.id);
    else if (r.status === "passed" && s === "failed") out.broken.push(r.id);
  }
  return out;
}

/** A fix run's own finish checks, then the caller's extra one (the acceptance gate's) only once its own pass. */
export async function withExtraChecks(own: Promise<string[]> | string[], extra?: { exitChecks?: () => Promise<string[]> }): Promise<string[]> {
  const first = await own;
  return first.length > 0 || !extra?.exitChecks ? first : extra.exitChecks();
}

export function fixRunUnaccounted(done: { filesWritten: number; disputes: number; escalations: number }): string | null {
  if (done.filesWritten > 0 || done.disputes > 0 || done.escalations > 0) return null;
  return (
    "You changed nothing, disputed nothing and handed nothing on. For each finding: fix it; or, if you checked and the facts " +
    "show it is not true, call dispute_finding with what you checked and saw; or, if it belongs to another builder, call " +
    "escalate_finding. A summary alone does not settle a finding."
  );
}
