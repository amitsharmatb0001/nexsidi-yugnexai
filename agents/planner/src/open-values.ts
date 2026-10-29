// Business values a plan names but does not give. Brewline 3's spec said "during store hours" and gave no hours, so the
// frontend offered pickup from 6:30 and the backend refused anything before 8:00: each builder invented its own value.
// A plan with an open value is not shown; the planner asks the customer first (2026-10-29, team plan stage 2).
import type { ProposedPlan } from "./types.ts";

export interface OpenValue {
  fact: string;
  where: string;
}

const TIME = /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b\d{1,2}[:.]\d{2}\b|24\/7|\bopen (?:all day|24 hours)\b/i;
const MONEY_OR_NONE = /[₹$€£]\s?\d|\b\d+(?:\.\d+)?\s?(?:rs|inr|usd|eur|gbp|%)(?![a-z])|\bno (?:\w+ )?(?:fee|fees|charge|charges)\b|\bfree\b/i;
const RATE = /\d+(?:\.\d+)?\s?%|\bno (?:tax|gst|vat)\b|\btax[- ]inclusive\b|\binclusive of (?:tax|gst|vat)\b|\b(?:tax|gst|vat) (?:is )?included\b/i;
const COUNT_OR_NONE = /\b\d+\b|\bno (?:limit|minimum|maximum|cap)\b|\bunlimited\b/i;
const DURATION = /\b\d+\s?(?:minute|min|hour|hr|day|week)s?\b|\bno (?:notice|lead time)\b|\bsame[- ]day\b/i;

// `anywhere`: a value anywhere in the plan counts (a clock time is never something else); otherwise it must be in a
// sentence that names the fact, so "a fee is added" is not settled by an unrelated price elsewhere.
const FACTS: Array<{ fact: string; named: RegExp; given: RegExp; anywhere?: boolean }> = [
  { fact: "opening hours", named: /\b(?:store|opening|business|working|operating|shop|office|clinic|trading)\s+hours\b|\bopening times?\b|\bhours of operation\b/i, given: TIME, anywhere: true },
  { fact: "fees", named: /\b(?:delivery|service|booking|cancellation|late|convenience|platform|processing|rental)\s+(?:fee|fees|charge|charges)\b/i, given: MONEY_OR_NONE },
  { fact: "tax rate", named: /\b(?:tax rate|sales tax|gst|vat)\b/i, given: RATE },
  { fact: "order limits", named: /\b(?:minimum|maximum|max|min)\s+(?:order|orders|quantity|booking|bookings|amount|spend)\b|\border limits?\b|\blimits? (?:on|of|per) (?:orders|bookings)\b/i, given: COUNT_OR_NONE },
  { fact: "notice or lead time", named: /\b(?:notice period|lead time|advance notice|booking window|cancellation (?:window|period|deadline))\b/i, given: DURATION },
  { fact: "deposit", named: /\bdeposits?\b/i, given: new RegExp(`${MONEY_OR_NONE.source}|${RATE.source}|\\bno deposit\\b`, "i") },
];

function sentences(texts: string[]): string[] {
  return texts.flatMap((t) => t.split(/(?<=[.;!?])\s+|\n+/)).map((s) => s.trim()).filter(Boolean);
}

/** Each fact named in the text with no value given in any sentence that names it. */
export function openValues(texts: string[]): OpenValue[] {
  const all = sentences(texts);
  const open: OpenValue[] = [];
  for (const f of FACTS) {
    const naming = all.filter((s) => f.named.test(s));
    if (naming.length === 0) continue;
    if ((f.anywhere ? all : naming).some((s) => f.given.test(s))) continue;
    open.push({ fact: f.fact, where: naming[0]! });
  }
  return open;
}

export function openValuesInPlan(plan: ProposedPlan): OpenValue[] {
  return openValues([
    plan.context ?? "",
    ...(plan.rules ?? []),
    ...[...(plan.publicPages ?? []), ...(plan.protectedPages ?? [])].map((p) => p.description ?? ""),
    ...(plan.apiEndpoints ?? []).map((e) => e.description ?? ""),
  ]);
}
