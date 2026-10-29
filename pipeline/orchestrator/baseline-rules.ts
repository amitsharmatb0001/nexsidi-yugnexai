// The rules every app keeps, whatever its spec: one list, read by the spec writer, the planner, the builders, the
// reviewers and the Chief AI (2026-10-29, team plan stage 2). Before, only the reviewers and the Chief AI had it, so a
// plan could be certain to fail its own review (Brewline 3: no column for the item's name at order time).

/** Fixed security baseline every generated app must meet (the generated-stack rules, independent of the spec). */
export const SECURITY_BASELINE: string[] = [
  "SQL uses parameter placeholders, never string-built queries",
  "Every endpoint the contract marks as requiring sign-in rejects requests without a valid token; role-limited endpoints reject other roles",
  "A signed-in user can only read and change their own records",
  "Passwords are hashed; no secret or password is hard-coded, written to a log or console, or kept in a test or example file that ships with the source (the only place a generated password appears is the owner's one-time login file)",
  "User input is never rendered as raw HTML",
  "Sign-in and sign-up are rate limited",
  "CORS allows only the app's own frontend",
  "The names of the tools that built the app, and the internal brief or spec text, never appear to users (page title, description and other metadata, errors, API responses)",
  // 2026-10-25 (brewline2): a sign-up that accepted role: 'staff' from the request was filed as "later" because the spec's own
  // wording allowed a staff sign-up. A plan cannot authorise a vulnerability.
  "No endpoint ever lets the caller choose a role or permissions for themselves (public sign-up creates the lowest role only; staff accounts come from a seeded account or from someone who already has that role)",
];

/** What every app keeps, independent of the spec: history is not changed by editing or deleting what it refers to. */
export const INTEGRITY_BASELINE: string[] = [
  "Deleting or editing a record that history refers to (a menu item, a product, a service) never deletes or changes what past orders, invoices or bookings recorded: their lines stay, with the name and price as they were at the time",
  "A check-then-write (is the item in stock, is the slot free) is one atomic step, so two requests at once cannot both pass it",
  // 2026-10-25 (brewline3): the frontend offered pickup slots from 6:30 and the backend refused anything before 8:00; the spec said
  // "during store hours" and gave no hours, so each side invented its own.
  "A business rule with a number in it (opening hours, minimum notice, order limits) is defined once, from the spec or the plan's stated default, and the frontend and the backend use the same values",
];

/** The rules as one section of an agent's instructions, each with the id the reviewers cite. */
export function baselineRulesSection(): string {
  return [
    "RULES EVERY APP KEEPS (the same list the reviewers check; a plan or a build that breaks one fails review):",
    ...SECURITY_BASELINE.map((r, i) => `[SEC${i + 1}] ${r}`),
    ...INTEGRITY_BASELINE.map((r, i) => `[INT${i + 1}] ${r}`),
  ].join("\n");
}
