// Does the change do what was asked? (2026-11-05, Express Build on tough changes.) Recurring invoices, shared households and loyalty points
// were all delivered and passed the live check, and in each the feature did not do what the customer asked: the "repeat" choice was ignored,
// plants never joined a household, 100 points took off $1 where the request said $5. The live check proves that pages and records work. These
// tests are written from the customer's own words by a reader who did not build the change, once, so a repair cannot change what it is judged
// by, and the fixed runner (no model) runs them on the running app. A build is done when they pass.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AcceptanceTest, ApiStep } from "./acceptance-tests.ts";
import type { RunSummary } from "./acceptance-runner.ts";

export interface Route {
  method: string;
  path: string;
}

export interface FeatureDeps {
  routes: () => Route[];
  /** the code the change touched: for field names and answer shapes, never for what is right */
  code: () => string;
  chat: (prompt: string) => Promise<string>;
  run: (tests: AcceptanceTest[]) => Promise<RunSummary>;
  repair: (request: string, opts: { journeyFailed: boolean; apiFailed: boolean }) => Promise<void>;
}

export interface FeatureResult {
  status: "passed" | "failing" | "not_checked";
  rounds: number;
  passed: number;
  failing: string[];
  notChecked: string[];
  dropped: string[];
}

const MAX_TESTS = 8;

export function featureTestPrompt(changes: string, routes: Route[], code: string): string {
  return `A customer asked for this change to their app. Someone else built it. You did not, and you do not trust that it works.

WHAT THE CUSTOMER ASKED, in their own words:
"""
${changes}
"""

Write up to ${MAX_TESTS} tests that fail if the app does not do what the customer asked. Test the whole feature from the first step a person takes
to the result they expect. Every number, limit and rule in their words gets a test with that exact value, including "only once", "never more than",
"only staff" and "a user must never see". If they said a person can do something, test that it really happens, not only that the request is accepted.

The routes the app has:
${routes.map((r) => `${r.method} ${r.path}`).join("\n")}

The code below is only for field names and answer shapes. It may be wrong. Your tests assert what the customer asked, never what the code does: where
the code disagrees with their words, the test follows their words and fails.
"""
${code}
"""

Answer with a JSON array only. Each test: {"title": "what it proves", "as": "anyone"|"user"|a role such as "staff", "kind": "api"|"journey", "steps": [...]}.
API steps: {"method", "path", "as" (optional, who sends this step), "body" (optional), "expectStatus" (a number or a list), "expectBody" (optional list of {"path", "equals"|"contains"|"exists"}), "save" (optional {"name": "path.in.answer"}, used later as {{name}})}.
An answer wrapped in {"data": ...} is read inside the wrapper. Paths in answers use dots, such as "order.discount_amount" or "items.0.id".
Journey steps: {"do": "open", "path"}, {"do": "fill", "field", "value"}, {"do": "choose", "field", "option"}, {"do": "click", "text"}, {"do": "see", "text"}, {"do": "atPath", "path"}.
Values: {{email}} and {{password}} (a new account), {{unique}}, {{date+N}}, {{minutes+N}}, {{as.email}}, and any saved value. To know a price, save it from an answer or have a role create the item with a price you choose.
Use only the routes above. Use "user" for a customer and a role for staff; there is one "user" account per test run.`;
}

const param = (seg: string) => /^(:|\{|\[)/.test(seg);

function routeFits(route: string, path: string): boolean {
  const a = route.split("?")[0]!.split("/").filter(Boolean);
  const b = path.split("?")[0]!.split("/").filter(Boolean);
  return a.length === b.length && a.every((seg, i) => param(seg) || param(b[i]!) || seg.toLowerCase() === b[i]!.toLowerCase());
}

/** The tests in a model's answer. A test on a route the app does not have is left out: it would send a builder after nothing. */
export function parseFeatureTests(answer: string, routes: Route[]): { tests: AcceptanceTest[]; dropped: string[] } {
  const start = answer.indexOf("[");
  const end = answer.lastIndexOf("]");
  let raw: unknown[] = [];
  try {
    raw = start >= 0 && end > start ? (JSON.parse(answer.slice(start, end + 1)) as unknown[]) : [];
  } catch {
    raw = [];
  }
  const tests: AcceptanceTest[] = [];
  const dropped: string[] = [];
  for (const item of raw.slice(0, MAX_TESTS)) {
    const t = item as Partial<AcceptanceTest>;
    if (!t || !Array.isArray(t.steps) || t.steps.length === 0 || (t.kind !== "api" && t.kind !== "journey")) {
      dropped.push(`not a test: ${JSON.stringify(item).slice(0, 120)}`);
      continue;
    }
    const unknown = t.kind === "api" ? (t.steps as ApiStep[]).find((s) => !routes.some((r) => r.method === String(s.method).toUpperCase() && routeFits(r.path, String(s.path)))) : undefined;
    if (unknown) {
      dropped.push(`"${t.title}": ${unknown.method} ${unknown.path} is not a route of the app`);
      continue;
    }
    tests.push({ id: `FT-${tests.length + 1}`, phase: 1, planItem: "REQUEST", title: String(t.title ?? "the request"), as: String(t.as ?? "anyone"), kind: t.kind, steps: t.steps } as AcceptanceTest);
  }
  return { tests, dropped };
}

export async function runFeatureTests(changes: string, deps: FeatureDeps, opts: { maxRepairs?: number } = {}): Promise<FeatureResult> {
  const maxRepairs = opts.maxRepairs ?? 2;
  const { tests, dropped } = parseFeatureTests(await deps.chat(featureTestPrompt(changes, deps.routes(), deps.code())), deps.routes());
  if (tests.length === 0) return { status: "not_checked", rounds: 0, passed: 0, failing: [], notChecked: ["no usable test was written from the request"], dropped };
  const byId = new Map(tests.map((t) => [t.id, t]));
  for (let rounds = 0; ; rounds++) {
    const run = await deps.run(tests);
    const failed = run.results.filter((r) => r.status === "failed");
    const failing = failed.map((r) => `${r.title}: ${r.detail}`);
    const notChecked = run.results.filter((r) => r.status === "not_checked").map((r) => `${r.title}: ${r.detail}`);
    if (failed.length === 0) return { status: run.passed > 0 ? "passed" : "not_checked", rounds, passed: run.passed, failing: [], notChecked, dropped };
    if (rounds >= maxRepairs) return { status: "failing", rounds, passed: run.passed, failing, notChecked, dropped };
    const kinds = failed.map((r) => byId.get(r.id)?.kind);
    await deps.repair(
      `The customer asked for this, and the running app does not do it yet:\n"""\n${changes}\n"""\nThese tests of what they asked fail on the running app. Fix the app so it does what the customer asked. The tests cannot be changed.\n${failing.map((f) => `- ${f}`).join("\n")}`,
      { journeyFailed: kinds.includes("journey"), apiFailed: kinds.includes("api") },
    );
  }
}

/** Public lists left empty by an app that has code to fill them: its seed failed. An older app with no seed code may start empty on purpose. */
export function seedFailed(facts: { hasSeedCode: boolean; listCounts: Record<string, number> }): string[] {
  if (!facts.hasSeedCode) return [];
  return Object.entries(facts.listCounts).filter(([, n]) => n === 0).map(([path]) => path);
}

function firstList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return null;
  for (const v of Object.values(value)) {
    const list = firstList(v);
    if (list) return list;
  }
  return null;
}

/** How many rows each public list answers with, on the running app. */
export async function publicListCounts(buildDir: string, backendUrl: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  let endpoints: Array<{ method?: string; path?: string; auth?: boolean }> = [];
  try {
    endpoints = (JSON.parse(readFileSync(join(buildDir, "api-contract.json"), "utf-8")) as { endpoints?: typeof endpoints }).endpoints ?? [];
  } catch {
    return counts;
  }
  for (const e of endpoints) {
    if (String(e.method).toUpperCase() !== "GET" || e.auth !== false || !e.path || /[:{]/.test(e.path) || /\/(health|auth|status|ping)(\/|$)/i.test(e.path)) continue;
    try {
      const r = await fetch(backendUrl + e.path, { signal: AbortSignal.timeout(15_000) });
      const list = r.ok ? firstList(await r.json()) : null;
      if (list) counts[e.path] = list.length;
    } catch {
      /* no answer: the live check reports that */
    }
  }
  return counts;
}

export function hasSeedCode(buildDir: string): boolean {
  try {
    return readdirSync(join(buildDir, "backend", "src", "db")).some((n) => /^seed/i.test(n));
  } catch {
    return false;
  }
}

const CODE_LIMIT = 40_000;

/** The backend's files this build changed, newest first, for field names and answer shapes. */
function changedBackendCode(buildDir: string, since: number): string {
  const root = join(buildDir, "backend", "src");
  const files: Array<{ path: string; at: number }> = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const n of readdirSync(d)) {
      const full = join(d, n);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n) && st.mtimeMs >= since) files.push({ path: full, at: st.mtimeMs });
    }
  };
  walk(root);
  let text = "";
  for (const f of files.sort((a, b) => b.at - a.at)) {
    if (text.length > CODE_LIMIT) break;
    text += `\n--- ${f.path.slice(root.length + 1).replace(/\\/g, "/")}\n${readFileSync(f.path, "utf-8")}`;
  }
  return text.slice(0, CODE_LIMIT);
}

/** The real steps: the running app, the real browser, and the test accounts and test rows removed after. */
export async function runFeatureTestsOnApp(opts: {
  buildDir: string;
  appUrl: string;
  backendUrl: string;
  changes: string;
  since: number;
  repair: FeatureDeps["repair"];
}): Promise<FeatureResult> {
  const { buildAppMap } = await import("./app-map/index.ts");
  const { createTestAccounts } = await import("./acceptance-gate-real.ts");
  const { runAcceptanceTests } = await import("./acceptance-runner.ts");
  const { BrowserSession } = await import("../../packages/agent-runtime/src/browser/client.ts");
  const { defaultTesterChat } = await import("../../agents/qa/aarav/src/index.ts");
  const riya = await import("../../agents/riya/src/index.ts");
  const contract = (JSON.parse(readFileSync(join(opts.buildDir, "api-contract.json"), "utf-8")) as { endpoints?: Array<{ method: string; path: string }> }).endpoints ?? [];
  riya.rememberTestingStart(opts.buildDir, riya.databaseNow(opts.buildDir));
  try {
    return await runFeatureTests(opts.changes, {
      routes: () => buildAppMap(opts.buildDir).endpoints.map((e) => ({ method: e.method.toUpperCase(), path: e.path })),
      code: () => changedBackendCode(opts.buildDir, opts.since),
      chat: defaultTesterChat,
      run: async (tests) => {
        const { accounts } = await createTestAccounts(opts.buildDir, opts.backendUrl, contract);
        return runAcceptanceTests(tests, { apiUrl: opts.backendUrl, appUrl: opts.appUrl, accounts, openBrowser: async () => new BrowserSession() });
      },
      repair: opts.repair,
    });
  } finally {
    riya.purgeVerificationArtifacts(opts.buildDir, null);
    riya.clearTestingStart(opts.buildDir);
  }
}
