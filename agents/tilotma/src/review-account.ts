// A ready test account with sample data for the live review agents (2026-10-05, Amit).
//
// The agents used to sign up their own empty accounts, so pages that need data (lists, detail pages, a filled
// dashboard) were judged empty and the real user flow (open a record, edit it, delete it, export) was never
// walked. The stage creates ONE test account on the reserved test domain, fills it with sample records, and
// puts its details in the environment; every review agent is told to use it. Everything under the account is
// removed — and checked — when the review ends.
export interface ReviewAccount {
  email: string;
  password: string;
}

export function reviewAccountFromEnv(): ReviewAccount | null {
  const email = process.env.TIER3_REVIEW_EMAIL;
  const password = process.env.TIER3_REVIEW_PASSWORD;
  return email && password ? { email, password } : null;
}

// 2026-10-23: the evaluator typed made-up addresses (newuser9988@outdoorcamp.test, alex@trailtest.com) that the cleanup could
// not tell from real data, and the leftovers failed the deploy. One rule for anything typed into the app, always included.
export const TEST_DATA_RULE =
  "TEST DATA RULE — any email address you type into the app (a new sign-up, a contact form, any form) must end in " +
  "@example.com, for example review+signup1@example.com. The data you create is removed after the review.";

export function reviewAccountSection(account: ReviewAccount | null, seeded: Record<string, number> = {}): string {
  if (!account) return `

${TEST_DATA_RULE}`;
  const have = Object.entries(seeded).filter(([, n]) => n > 0).map(([name, n]) => `${n} ${name}`);
  return `

TEST ACCOUNT WITH SAMPLE DATA — a ready account exists for the signed-in part of your review:
  email: ${account.email}
  password: ${account.password}
${have.length > 0 ? `It already holds sample records (${have.join(", ")}).\n` : ""}Sign in with it through the app's own sign-in page. Then walk the whole user flow like a real user would:
open every list and every detail page, create a new record, edit one, change a status, delete one that you created,
export if the app offers it, and update the settings. Every step that fails or looks wrong for this account is a
finding — quote exactly what you did and what you saw. The data is fake and is removed after the review, so it is
safe to change. Also test sign-up once with a NEW address (not this account) to see that registration works.

${TEST_DATA_RULE}`;
}

/** How many sample records of each resource the stage created (a JSON object in TIER3_REVIEW_SEEDED). */
export function reviewSeededFromEnv(): Record<string, number> {
  try {
    const parsed = JSON.parse(process.env.TIER3_REVIEW_SEEDED ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, n]) => typeof n === "number")) as Record<string, number>;
  } catch {
    return {};
  }
}
