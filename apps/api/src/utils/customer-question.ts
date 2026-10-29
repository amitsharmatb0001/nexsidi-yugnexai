// A question for the customer during a build (team plan stage 2, 2026-10-29). Security Layer 7: what reaches the browser is
// the question in the customer's words only — no agent names, no internal words (CLAUDE.md confidentiality).
import { toCustomerText } from "../../../../packages/agent-runtime/src/customer-text.ts";

/** The question the build is waiting on, in the customer's words, or null. */
export function pendingCustomerQuestion(state: unknown): string | null {
  const s = state as { pendingQuestions?: unknown } | null;
  const q = Array.isArray(s?.pendingQuestions) ? s!.pendingQuestions[0] : null;
  return typeof q === "string" && q.trim() ? toCustomerText(q.trim()) : null;
}

/** The customer's answer, trimmed and kept to a sensible length; null when there is nothing in it. */
export function cleanAnswer(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, 2_000);
  return text ? text : null;
}
