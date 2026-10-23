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

/** One ready account per limited role (staff, admin, ...), made by the review stage (TIER3_REVIEW_ROLE_ACCOUNTS). */
export interface RoleReviewAccount extends ReviewAccount {
  role: string;
}

export function reviewRoleAccountsFromEnv(): RoleReviewAccount[] {
  try {
    const parsed = JSON.parse(process.env.TIER3_REVIEW_ROLE_ACCOUNTS ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as RoleReviewAccount[]).filter((a) => a && typeof a.role === "string" && typeof a.email === "string" && typeof a.password === "string") : [];
  } catch {
    return [];
  }
}

// 2026-10-24 (Brewline live review): with no staff login the reality checker hunted for one and had a sub-check overwrite
// the real staff password. The checkers get one account per limited role and are told never to change any account.
const ACCOUNT_RULE =
  "ACCOUNT RULE — never change any account's password or role, never create accounts directly in the database, and " +
  "never read passwords out of code, logs or the database. If a page needs an account you were not given, report that " +
  "page as not checked and say which account was missing.";

function roleAccountsBlock(roleAccounts: RoleReviewAccount[]): string {
  if (roleAccounts.length === 0) return "";
  const lines = roleAccounts.map((a) => `  ${a.role}: email ${a.email}  password ${a.password}`).join("\n");
  return `

ROLE ACCOUNTS — ready accounts for the pages limited to a role. Sign in with the one the page needs, through the app's
own sign-in page, and walk that role's whole flow (every page it can reach, create, edit and change the status of records):
${lines}`;
}

export function reviewAccountSection(
  account: ReviewAccount | null,
  seeded: Record<string, number> = {},
  roleAccounts: RoleReviewAccount[] = reviewRoleAccountsFromEnv(),
): string {
  if (!account) return `${roleAccountsBlock(roleAccounts)}

${ACCOUNT_RULE}

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
safe to change. Also test sign-up once with a NEW address (not this account) to see that registration works.${roleAccountsBlock(roleAccounts)}

${ACCOUNT_RULE}

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
