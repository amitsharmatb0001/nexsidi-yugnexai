// Aarav, the tester (2026-10-29, team plan stage 3). In the roster since the start, never built: until now nobody wrote
// down what "works" means before the code, so the builders tested their own code and the reviewers judged it afterwards.
// Right after the customer approves the plan, Aarav writes each build phase's acceptance tests from the approved plan
// only: the request, the plan items, the API contract, the pages and the answers given. The Chief AI's check
// (pipeline/orchestrator/acceptance-tests.ts) refuses any test outside the plan; Aarav is shown why and corrects it, and
// is asked for any endpoint or page of the phase that has no test yet (two rounds at most). The system numbers the tests
// and places them in their phase; a phase Aarav cannot write tests for is recorded, never guessed, and never stops the build.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkAcceptanceTests,
  normalizePath,
  planScope,
  saveAcceptanceTests,
  type AcceptanceSuite,
  type AcceptanceTest,
  type ApiStep,
  type JourneyStep,
  type PlanScope,
} from "../../../../pipeline/orchestrator/acceptance-tests.ts";
import { planSection } from "../../../../pipeline/orchestrator/chief-check.ts";

export type TesterChat = (prompt: string) => Promise<string>;

export interface TesterDeps {
  chat: TesterChat;
  now?: () => Date;
}

const FIRST_ATTEMPTS = 2;
const REPAIR_ROUNDS = 2;

const readJson = <T>(file: string): T | null => {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf-8")) as T) : null;
  } catch {
    return null;
  }
};

type Phase = { name?: string; goal?: string; pages?: string[]; endpoints?: string[]; tables?: string[] };

function phasesOf(projectDir: string): Phase[] {
  const plan = readJson<{ buildPhases?: Phase[] }>(join(projectDir, "build-plan.json"));
  const planner = readJson<{ buildPhases?: Phase[] }>(join(projectDir, "planner-plan.json"));
  const phases = plan?.buildPhases?.length ? plan.buildPhases : (planner?.buildPhases ?? []);
  return phases.length ? phases : [{ name: "The whole app", goal: "everything the plan describes" }];
}

function contractLines(projectDir: string): string[] {
  const c = readJson<{ endpoints?: Array<Record<string, unknown>> }>(join(projectDir, "api-contract.json"));
  return (c?.endpoints ?? []).map((e) => {
    const parts = [`${String(e.method ?? "").toUpperCase()} ${e.path ?? ""} — ${e.description ?? ""}`];
    if (e.requestType && e.requestType !== "null") parts.push(`request ${e.requestType}`);
    if (e.responseType) parts.push(`answer ${e.responseType}`);
    if (Array.isArray(e.errorCodes) && e.errorCodes.length) parts.push(`errors ${e.errorCodes.join(", ")}`);
    return parts.join(" | ");
  });
}

function pageLines(projectDir: string, scope: PlanScope): string[] {
  const planner = readJson<{ pages?: Array<{ path?: string; description?: string }> }>(join(projectDir, "planner-plan.json"));
  const describe = new Map((planner?.pages ?? []).filter((p) => p.path).map((p) => [normalizePath(p.path!), p.description ?? ""]));
  return scope.pages.map((p) => `${p.path} (phase ${p.phase})${describe.get(normalizePath(p.path)) ? ` — ${describe.get(normalizePath(p.path))}` : ""}`);
}

const FORMAT = `FORMAT — reply with ONLY a JSON list of tests (no id, no phase: the system numbers them):
[
  {"planItem": "INT1", "title": "an order keeps the item's name after staff rename the item", "as": "user", "kind": "api", "steps": [
    {"as": "staff", "method": "POST", "path": "/api/v1/menu", "body": {"name": "Flat White {{unique}}", "price": 4.5}, "expectStatus": [200, 201], "save": {"itemId": "id"}},
    {"method": "POST", "path": "/api/v1/orders", "body": {"items": [{"menuItemId": "{{itemId}}", "quantity": 1}]}, "expectStatus": 201, "save": {"orderId": "id"}},
    {"as": "staff", "method": "PATCH", "path": "/api/v1/menu/{{itemId}}", "body": {"name": "Renamed"}, "expectStatus": 200},
    {"method": "GET", "path": "/api/v1/orders/{{orderId}}", "expectStatus": 200, "expectBody": [{"path": "items.0.name", "contains": "Flat White"}]}
  ]},
  {"planItem": "SC2", "title": "a visitor creates an account on the sign-up page", "as": "anyone", "kind": "journey", "steps": [
    {"do": "open", "path": "/sign-up"},
    {"do": "fill", "field": "Email", "value": "{{email}}"},
    {"do": "fill", "field": "Password", "value": "{{password}}"},
    {"do": "click", "text": "Create account"},
    {"do": "atPath", "path": "/menu"}
  ]}
]
API steps: method, path, optional "as" (who sends this step when not the test's own person), optional body, expectStatus
(a number or a list of the numbers the contract allows), optional expectBody checks {"path": "a.0.b", "equals" | "contains" |
"exists": …}, optional save {"name": "path.in.answer"} to use as {{name}} later. Paths in answers follow the contract's
answer shape exactly.
Journey steps: {"do": "open", "path"}, {"do": "fill", "field", "value"}, {"do": "choose", "field", "option"},
{"do": "click", "text"}, {"do": "see", "text"}, {"do": "notSee", "text"}, {"do": "atPath", "path"}. A journey starts with "open".
Values: {{email}} and {{password}} (a new account, the same within one test), {{unique}}, {{date+N}} (the date N days from
today), {{datetime+N HH:MM}} (that day at that local time), {{as.email}} and {{as.password}} (the test's own account), and
any value an earlier step saved.`;

const RULES = `RULES:
1. Every test proves ONE item of the approved plan above and names it in "planItem" (SC…, EP…, SEC…, INT…, ANS…).
   Cover this phase's success criteria and endpoints; add the rules every app keeps where this phase's endpoints touch
   them: a person without the right role is refused (SEC2), a user cannot read another user's records (SEC3), sign-up cannot
   choose a role (SEC9), an order keeps the item's name and price after the item is edited or deleted (INT1).
2. Use ONLY endpoints of the API contract and pages of the plan, built in this phase or an earlier one.
3. Request bodies and answer paths follow the contract's request and answer shapes exactly. Never invent a field.
4. Never invent a business value (hours, prices, limits, fees). Use a value only when the request, the plan or the answers
   given state it. A rule whose value is not stated is not tested for that value.
5. Journeys use what a person sees: a field's label, a button's words, text on the page. Use the plainest words that fit
   the plan's page descriptions ("Email", "Password", "Sign in", "Add item"); the builders build to your exact words.
6. "as" is who runs the test: "anyone" (signed out), "user" (an ordinary signed-up account) or a role of the plan. A
   signed-in journey starts already signed in; to test the sign-in itself, run as "anyone" and sign in on the page.
7. Include failure cases: wrong input refused (400), no sign-in refused (401), the wrong person refused (403 or 404).
8. Between 4 and 12 tests for the phase, each 1 to 8 steps. Do not test colours or fonts: the design review covers them.`;

/** The tester's task for one phase. */
export function testerPrompt(projectDir: string, phase: number, scope: PlanScope = planScope(projectDir)): string {
  const phases = phasesOf(projectDir);
  const ph = phases[phase - 1] ?? phases[0]!;
  const earlier = phases.slice(0, phase - 1).map((p, i) => `${i + 1}. ${p.name ?? ""} — ${p.goal ?? ""}`);
  const request = existsSync(join(projectDir, "user-request.txt")) ? readFileSync(join(projectDir, "user-request.txt"), "utf-8").slice(0, 8_000) : "(not recorded)";
  const people = ["anyone", "user", ...scope.roles].map((p) => `"${p}"`).join(", ");
  return [
    "You are Aarav, the tester. The customer has approved the plan below and no code exists yet. Write the acceptance tests",
    "this build phase must pass: what a customer would check by hand, written so a fixed runner can check it on the running",
    "app. The builders build to your tests and cannot change them, so every word must come from the plan.",
    "",
    `PHASE ${phase} of ${phases.length} — ${ph.name ?? ""}: ${ph.goal ?? ""}`,
    `Pages of this phase: ${(ph.pages ?? []).join(", ") || "(none)"}`,
    `Endpoints of this phase: ${(ph.endpoints ?? []).join(", ") || "(none)"}`,
    `Tables of this phase: ${(ph.tables ?? []).join(", ") || "(none)"}`,
    earlier.length ? `Earlier phases (already built when this phase is tested): ${earlier.join("; ")}` : "This is the first phase.",
    "",
    `THE CUSTOMER'S REQUEST:\n${request}`,
    "",
    `THE APPROVED PLAN ITEMS (every test names one):\n${planSection(projectDir)}`,
    "",
    `THE API CONTRACT:\n${contractLines(projectDir).join("\n")}`,
    "",
    `THE PAGES OF THE PLAN:\n${pageLines(projectDir, scope).join("\n")}`,
    "",
    `PEOPLE a test can run as: ${people}.`,
    "",
    RULES,
    "",
    FORMAT,
  ].join("\n");
}

/** Every phase's task, in order: the step's inputs (a retry with the same inputs reuses the tests). */
export function testerPrompts(projectDir: string): string[] {
  const scope = planScope(projectDir);
  return phasesOf(projectDir).map((_, i) => testerPrompt(projectDir, i + 1, scope));
}

function parseTests(raw: string): unknown[] | null {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(raw.slice(start, end + 1)) as unknown;
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** What this phase lists that no accepted test of the phase uses yet. */
function missingCoverage(tests: AcceptanceTest[], ph: Phase): string[] {
  const used = new Set<string>();
  const opened = new Set<string>();
  for (const t of tests) {
    if (t.kind === "api") for (const s of t.steps as ApiStep[]) used.add(`${String(s.method).toUpperCase()} ${normalizePath(s.path)}`);
    else for (const s of t.steps as JourneyStep[]) if (s.do === "open") opened.add(normalizePath(s.path));
  }
  const missing: string[] = [];
  for (const e of ph.endpoints ?? []) {
    const [method, path] = e.trim().split(/\s+/);
    if (method && path && !used.has(`${method.toUpperCase()} ${normalizePath(path)}`)) missing.push(`${method.toUpperCase()} ${path}`);
  }
  for (const p of ph.pages ?? []) if (!opened.has(normalizePath(p))) missing.push(`the page ${p}`);
  return missing;
}

function repairPrompt(base: string, rejected: Array<{ test: unknown; reasons: string[] }>, missing: string[]): string {
  const parts = [base, "", "YOUR TESTS SO FAR NEED WORK. Reply with ONLY a JSON list of the corrected and the new tests (the accepted ones are kept)."];
  if (rejected.length) {
    parts.push("", "These tests were refused by the plan check, with why. Correct each one, or leave it out if the plan cannot support it:");
    for (const r of rejected) parts.push(`- ${JSON.stringify(r.test)}\n  REFUSED: ${r.reasons.join("; ")}`);
  }
  if (missing.length) parts.push("", `No test yet for: ${missing.join(", ")}. Add tests for them.`);
  return parts.join("\n");
}

/** Writes and saves every phase's acceptance tests. Never throws: what could not be written is recorded in the suite. */
export async function writeAcceptanceTests(projectDir: string, deps: TesterDeps): Promise<AcceptanceSuite> {
  const scope = planScope(projectDir);
  const phases = phasesOf(projectDir);
  const suite: AcceptanceSuite = { writtenAt: (deps.now ?? (() => new Date()))().toISOString(), tests: [], rejected: [], notWritten: [], gaps: [] };
  for (let phase = 1; phase <= phases.length; phase++) {
    const base = testerPrompt(projectDir, phase, scope);
    let raw: unknown[] | null = null;
    let lastError = "";
    for (let attempt = 1; attempt <= FIRST_ATTEMPTS && !raw; attempt++) {
      try {
        raw = parseTests(await deps.chat(base));
        if (!raw) lastError = "the tester's answer had no JSON list of tests";
      } catch (err) {
        lastError = `the tester could not be reached: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`;
      }
    }
    if (!raw) {
      suite.notWritten.push({ phase, reason: `${lastError} (${FIRST_ATTEMPTS} attempts)` });
      continue;
    }
    const accepted: AcceptanceTest[] = [];
    const take = (list: unknown[]) => {
      // The system, not the model, numbers the tests and places them in this phase.
      const numbered = list.map((t, i) => ({ ...(t as object), id: `AT-${phase}-${accepted.length + i + 1}`, phase }) as AcceptanceTest);
      const r = checkAcceptanceTests(numbered, projectDir, scope);
      accepted.push(...r.accepted.map((t, i) => ({ ...t, id: `AT-${phase}-${accepted.length + i + 1}` })));
      return r.rejected.map((x) => ({ test: stripSystemFields(x.test), reasons: x.reasons }));
    };
    let rejected = take(raw);
    let missing = missingCoverage(accepted, phases[phase - 1]!);
    for (let round = 1; round <= REPAIR_ROUNDS && (rejected.length > 0 || missing.length > 0); round++) {
      let more: unknown[] | null = null;
      try {
        more = parseTests(await deps.chat(repairPrompt(base, rejected, missing)));
      } catch (err) {
        console.warn(`[aarav] phase ${phase}: the correction round failed: ${String(err).slice(0, 160)}`);
      }
      if (!more) break;
      rejected = take(more);
      missing = missingCoverage(accepted, phases[phase - 1]!);
    }
    suite.tests.push(...accepted);
    suite.rejected.push(...rejected);
    if (missing.length) suite.gaps!.push({ phase, missing });
    console.log(`[aarav] phase ${phase}: ${accepted.length} test(s) accepted, ${rejected.length} refused${missing.length ? `, no test for ${missing.join(", ")}` : ""}`);
  }
  saveAcceptanceTests(projectDir, suite);
  return suite;
}

function stripSystemFields(t: unknown): unknown {
  if (!t || typeof t !== "object") return t;
  const { id: _id, phase: _phase, ...rest } = t as Record<string, unknown>;
  return rest;
}

/** The real model call: one plain chat on the reviewers' tier, recorded in the call ledger as the tester's. */
export const defaultTesterChat: TesterChat = async (prompt) => {
  const { routeWithFallback, withCallContext } = await import("../../../../packages/llm-client/src/index.ts");
  const r = await withCallContext({ agent: "aarav", tier: "qa" }, () => routeWithFallback("qa", [{ role: "user", content: prompt }], { maxTokens: 16_000 }));
  return r.content;
};
