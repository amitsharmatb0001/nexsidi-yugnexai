// 2026-10-04 (Ledgerly run 4, final pass): the design evaluator drove the app and
// wrote a factual log with no judgement and no scores. A follow-up that asked
// another model to invent the scores from that log produced numbers with
// reasoning about "Tailwind defaults" the app does not use — a guess. A judge
// must produce its verdict itself, while it still has its evidence in front of
// it: a run can be given a format its final summary must match, and a finish
// that does not match is refused (with the reason) so the run keeps working.
export interface SummaryRule {
  pattern: RegExp;
  message: string;
}

export function summaryRejection(rule: SummaryRule | undefined, summary: string): string | null {
  if (!rule) return null;
  return rule.pattern.test(String(summary ?? "")) ? null : rule.message;
}
