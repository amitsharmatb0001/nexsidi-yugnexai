// Acceptance tests (2026-10-29, team plan stage 3). Before this, nobody wrote down what "works" means before the code: the
// builders tested their own code and the reviewers judged it afterwards. Now the tester writes, right after the customer
// approves the plan, the tests each build phase must pass, each naming the plan item it proves (SC3, EP7, INT1). Two kinds:
//   api      — requests and the expected answers, run straight against the backend
//   journey  — open a page, fill in, click, expect to see text, run in a real browser
// They are data in <build>/acceptance-tests.json, outside every builder's folder, so no builder can change them. The fixed
// runner (acceptance-runner.ts, no model) runs them on the running app. The Chief AI's check below keeps only tests that
// prove a plan item with the pages, endpoints and people the approved plan has (the same rule as out-of-scope.ts).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planItemsFor } from "./chief-check.ts";
import { limitedRolesFromContract } from "../../agents/riya/src/index.ts";

export const TESTS_FILE = "acceptance-tests.json";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const METHODS = new Set<string>(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/** One thing the answer must hold. `path` is a dot path into the JSON answer ("token", "items.0.name"). */
export interface BodyCheck {
  path: string;
  equals?: unknown;
  exists?: boolean;
  contains?: string | number;
}

export interface ApiStep {
  method: HttpMethod;
  path: string;
  /** who sends this step, when not the test's own `as` */
  as?: string;
  body?: unknown;
  expectStatus: number | number[];
  expectBody?: BodyCheck[];
  /** name → dot path of the answer, usable as {{name}} in later steps */
  save?: Record<string, string>;
}

export type JourneyStep =
  | { do: "open"; path: string }
  | { do: "fill"; field: string; value: string }
  | { do: "choose"; field: string; option: string }
  | { do: "click"; text: string }
  | { do: "see"; text: string }
  | { do: "notSee"; text: string }
  | { do: "atPath"; path: string };

export interface AcceptanceTest {
  id: string;
  phase: number;
  planItem: string;
  title: string;
  /** "anyone" (signed out), "user" (an ordinary signed-up account) or a role of the plan ("staff") */
  as: string;
  kind: "api" | "journey";
  steps: ApiStep[] | JourneyStep[];
  /** who wrote it: the tester (default) or a review finding the runner reproduced (team plan stage 5) */
  source?: "tester" | "review";
}

export interface AcceptanceSuite {
  writtenAt: string;
  tests: AcceptanceTest[];
  /** tests the Chief AI's check refused, with why */
  rejected: Array<{ test: unknown; reasons: string[] }>;
  /** phases the tester could not write tests for, with why */
  notWritten: Array<{ phase: number; reason: string }>;
  /** endpoints and pages of a phase that no accepted test uses */
  gaps?: Array<{ phase: number; missing: string[] }>;
  /** tests the Chief AI ruled wrong when a builder disputed them (team plan stage 4); they no longer count */
  withdrawn?: Array<{ id: string; evidence: string; at: string }>;
}

// ── The plan's scope ────────────────────────────────────────────────────────

export interface PlanScope {
  itemIds: Set<string>;
  roles: string[];
  endpoints: Array<{ method: string; path: string; phase: number }>;
  pages: Array<{ path: string; phase: number }>;
  phaseCount: number;
}

const readJson = <T>(file: string): T | null => {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf-8")) as T) : null;
  } catch {
    return null;
  }
};

/** A path for comparing: no query, no trailing slash, every parameter (":id", "[id]", "{id}", "{{id}}") as "*". */
export function normalizePath(p: string): string {
  const bare = p.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  return bare
    .split("/")
    .map((s) => (/^(:|\[|\{|\*)/.test(s) || /\{\{[^}]*\}\}/.test(s) ? "*" : s.toLowerCase()))
    .join("/");
}

/**
 * A path a test uses fits a path of the plan when every part is equal, or either part is a parameter: the plan's ":id" or
 * "[id]" takes a concrete id ("/api/v1/orders/1", 2026-10-30, a reviewer's reproduction), and a test's {{saved}} value fits
 * any part.
 */
export function pathFits(planPath: string, testPath: string): boolean {
  const a = normalizePath(planPath).split("/");
  const b = normalizePath(testPath).split("/");
  return a.length === b.length && a.every((seg, i) => seg === "*" || b[i] === "*" || seg === b[i]);
}

type Phase = { endpoints?: string[]; pages?: string[] };

export function planScope(projectDir: string): PlanScope {
  const contract = readJson<{ endpoints?: Array<{ method?: string; path?: string; description?: string }> }>(join(projectDir, "api-contract.json"));
  const plan = readJson<{ buildPhases?: Phase[] }>(join(projectDir, "build-plan.json"));
  const planner = readJson<{ pages?: Array<{ path?: string }>; buildPhases?: Phase[] }>(join(projectDir, "planner-plan.json"));
  const phases = plan?.buildPhases?.length ? plan.buildPhases : (planner?.buildPhases ?? []);
  const phaseOfEndpoint = new Map<string, number>();
  const pages = new Map<string, { path: string; phase: number }>();
  phases.forEach((ph, i) => {
    for (const e of ph.endpoints ?? []) {
      const [method, path] = e.trim().split(/\s+/);
      if (method && path && !phaseOfEndpoint.has(`${method.toUpperCase()} ${normalizePath(path)}`)) phaseOfEndpoint.set(`${method.toUpperCase()} ${normalizePath(path)}`, i + 1);
    }
    for (const p of ph.pages ?? []) if (!pages.has(normalizePath(p))) pages.set(normalizePath(p), { path: p, phase: i + 1 });
  });
  // A page or endpoint the phases do not list belongs to the whole app: any phase may use it.
  for (const p of planner?.pages ?? []) if (p.path && !pages.has(normalizePath(p.path))) pages.set(normalizePath(p.path), { path: p.path, phase: 1 });
  const endpoints = (contract?.endpoints ?? [])
    .filter((e) => e.method && e.path)
    .map((e) => ({ method: e.method!.toUpperCase(), path: e.path!, phase: phaseOfEndpoint.get(`${e.method!.toUpperCase()} ${normalizePath(e.path!)}`) ?? 1 }));
  return {
    itemIds: new Set(planItemsFor(projectDir).map((i) => i.id)),
    roles: limitedRolesFromContract(contract?.endpoints ?? []),
    endpoints,
    pages: [...pages.values()],
    phaseCount: Math.max(1, phases.length),
  };
}

// ── Placeholders ────────────────────────────────────────────────────────────

export interface TestContext {
  stamp: string;
  now: Date;
  saved: Record<string, unknown>;
  account?: { email: string; password: string };
}

export function testContext(opts: { now?: Date; stamp?: string; account?: { email: string; password: string } } = {}): TestContext {
  return { stamp: opts.stamp ?? `${Date.now()}${Math.floor(Math.random() * 1000)}`, now: opts.now ?? new Date(), saved: {}, account: opts.account };
}

const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g;
const DATE = /^date([+-]\d+)$/;
const DATETIME = /^datetime([+-]\d+) (\d{2}):(\d{2})$/;
const BUILTIN = ["unique", "email", "password", "as.email", "as.password"];

const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function localDateTime(d: Date): string {
  const off = -d.getTimezoneOffset();
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${off >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

function builtin(name: string, ctx: TestContext): unknown {
  if (name === "unique") return ctx.stamp;
  // example.com is the reserved test domain: every account on it is removed when the review ends.
  if (name === "email") return `verify+at${ctx.stamp}@example.com`;
  if (name === "password") return `Accept!${ctx.stamp}aA1`;
  if (name === "as.email") return ctx.account?.email;
  if (name === "as.password") return ctx.account?.password;
  const d = name.match(DATE);
  if (d) return localDate(new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate() + Number(d[1])));
  const t = name.match(DATETIME);
  if (t) return localDateTime(new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate() + Number(t[1]), Number(t[2]), Number(t[3])));
  return name in ctx.saved ? ctx.saved[name] : undefined;
}

function isKnownBuiltin(name: string): boolean {
  return BUILTIN.includes(name) || DATE.test(name) || DATETIME.test(name);
}

/** Every {{name}} replaced. A value that is only a placeholder keeps the saved value's type (an id stays a number). */
export function expandPlaceholders(value: unknown, ctx: TestContext): unknown {
  if (typeof value === "string") {
    const whole = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    if (whole) {
      const v = builtin(whole[1]!, ctx);
      return v === undefined ? value : v;
    }
    return value.replace(PLACEHOLDER, (m, name: string) => {
      const v = builtin(name, ctx);
      return v === undefined ? m : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => expandPlaceholders(v, ctx));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expandPlaceholders(v, ctx)]));
  return value;
}

function placeholdersIn(value: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") for (const m of v.matchAll(PLACEHOLDER)) out.push(m[1]!);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
  return out;
}

// ── The Chief AI's check of the tests ───────────────────────────────────────

const JOURNEY_FIELDS: Record<string, string[]> = {
  open: ["path"],
  fill: ["field", "value"],
  choose: ["field", "option"],
  click: ["text"],
  see: ["text"],
  notSee: ["text"],
  atPath: ["path"],
};

function checkOne(t: AcceptanceTest, scope: PlanScope): string[] {
  const reasons: string[] = [];
  if (!t || typeof t !== "object") return ["not a test object"];
  if (!String(t.title ?? "").trim()) reasons.push("give the test a title that says what it proves");
  if (!scope.itemIds.has(String(t.planItem ?? "").toUpperCase())) reasons.push(`${t.planItem || "(no plan item)"} is not an item of the approved plan`);
  const people = ["anyone", "user", ...scope.roles];
  const checkWho = (who: unknown, where: string) => {
    if (!people.includes(String(who))) reasons.push(`${where}"${String(who)}" is not someone the plan has (use ${people.map((p) => `"${p}"`).join(", ")})`);
  };
  checkWho(t.as, "");
  const steps = Array.isArray(t.steps) ? t.steps : [];
  if (steps.length === 0) reasons.push("the test has no steps");
  const phase = Number(t.phase) || 1;
  const usedIn = (what: string, built: number) => {
    if (built > phase) reasons.push(`${what} is built in phase ${built}, after this test's phase ${phase}`);
  };
  const saved = new Set<string>();
  const checkPlaceholders = (value: unknown, n: number) => {
    for (const name of placeholdersIn(value)) {
      if (isKnownBuiltin(name) || saved.has(name)) continue;
      if (steps.some((s) => s && typeof s === "object" && "save" in s && (s as ApiStep).save && name in (s as ApiStep).save!)) {
        reasons.push(`step ${n}: {{${name}}} is used before a step saves it`);
      } else {
        reasons.push(`step ${n}: {{${name}}} is not a known value (use a value from the plan, a saved value, or one of {{unique}}, {{email}}, {{password}}, {{date+N}}, {{datetime+N HH:MM}}, {{as.email}}, {{as.password}})`);
      }
    }
  };

  if (t.kind === "api") {
    (steps as ApiStep[]).forEach((s, i) => {
      const n = i + 1;
      if (!s || typeof s !== "object") return void reasons.push(`step ${n}: not a step object`);
      const method = String(s.method ?? "").toUpperCase();
      if (!METHODS.has(method)) reasons.push(`step ${n}: "${s.method}" is not a request method`);
      const path = String(s.path ?? "");
      if (!path.startsWith("/")) reasons.push(`step ${n}: the path must start with / (a path of the app, not an address)`);
      else {
        const ep = scope.endpoints.find((e) => e.method === method && pathFits(e.path, path));
        if (!ep) reasons.push(`step ${n}: ${method} ${path} is not in the approved API contract`);
        else usedIn(`${method} ${ep.path}`, ep.phase);
      }
      if (s.as !== undefined) checkWho(s.as, `step ${n}: `);
      const statuses = Array.isArray(s.expectStatus) ? s.expectStatus : [s.expectStatus];
      if (s.expectStatus === undefined || statuses.length === 0 || statuses.some((x) => !Number.isInteger(x) || x < 100 || x > 599)) {
        reasons.push(`step ${n}: give the expected status (a number such as 200, or a list such as [200, 201])`);
      }
      for (const c of s.expectBody ?? []) {
        if (!c || typeof c.path !== "string" || !c.path.trim()) reasons.push(`step ${n}: each answer check needs a path`);
        else if (c.equals === undefined && c.exists === undefined && c.contains === undefined) reasons.push(`step ${n}: the check of ${c.path} says nothing (use equals, exists or contains)`);
      }
      checkPlaceholders([s.path, s.body, s.expectBody], n);
      for (const [name, from] of Object.entries(s.save ?? {})) {
        if (typeof from !== "string" || !from.trim()) reasons.push(`step ${n}: save ${name} needs the path of the value in the answer`);
        saved.add(name);
      }
    });
  } else if (t.kind === "journey") {
    (steps as JourneyStep[]).forEach((s, i) => {
      const n = i + 1;
      if (!s || typeof s !== "object") return void reasons.push(`step ${n}: not a step object`);
      const fields = JOURNEY_FIELDS[(s as { do: string }).do];
      if (!fields) return void reasons.push(`step ${n}: "${(s as { do: string }).do}" is not a journey step (use ${Object.keys(JOURNEY_FIELDS).join(", ")})`);
      for (const f of fields) {
        if (!String((s as Record<string, unknown>)[f] ?? "").trim()) reasons.push(`step ${n}: ${s.do} needs a ${f}`);
      }
      if (s.do === "open" || s.do === "atPath") {
        const page = scope.pages.find((p) => pathFits(p.path, s.path ?? ""));
        if (!String(s.path ?? "").startsWith("/")) reasons.push(`step ${n}: the path must start with / (a page of the app, not an address)`);
        else if (!page) reasons.push(`step ${n}: ${s.path} is not a page of the approved plan`);
        else usedIn(`the page ${page.path}`, page.phase);
      }
      checkPlaceholders(s, n);
    });
    if ((steps as JourneyStep[])[0]?.do !== "open") reasons.push("a journey starts by opening a page");
  } else {
    reasons.push(`"${String((t as { kind?: unknown }).kind)}" is not a kind of test (use "api" or "journey")`);
  }
  if (phase < 1 || phase > scope.phaseCount) reasons.push(`phase ${t.phase} is not a phase of the plan`);
  return reasons;
}

/** The Chief AI's check: every test proves a named plan item, with only the pages, endpoints and people the plan has. */
export function checkAcceptanceTests(tests: AcceptanceTest[], projectDir: string, scope: PlanScope = planScope(projectDir)): {
  accepted: AcceptanceTest[];
  rejected: Array<{ test: AcceptanceTest; reasons: string[] }>;
} {
  const accepted: AcceptanceTest[] = [];
  const rejected: Array<{ test: AcceptanceTest; reasons: string[] }> = [];
  const ids = new Set<string>();
  for (const t of tests) {
    const reasons = checkOne(t, scope);
    if (t && ids.has(t.id)) reasons.push(`the id ${t.id} is used twice`);
    if (reasons.length) rejected.push({ test: t, reasons });
    else {
      ids.add(t.id);
      accepted.push({ ...t, planItem: t.planItem.toUpperCase() });
    }
  }
  return { accepted, rejected };
}

// ── Storage ─────────────────────────────────────────────────────────────────

export function saveAcceptanceTests(projectDir: string, suite: AcceptanceSuite): void {
  writeFileSync(join(projectDir, TESTS_FILE), JSON.stringify(suite, null, 2));
}

export function readAcceptanceTests(projectDir: string): AcceptanceSuite | null {
  return readJson<AcceptanceSuite>(join(projectDir, TESTS_FILE));
}

/** The tests that count: every test the Chief AI has not withdrawn. */
export function activeTests(suite: AcceptanceSuite | null): AcceptanceTest[] {
  const gone = new Set((suite?.withdrawn ?? []).map((w) => w.id));
  return (suite?.tests ?? []).filter((t) => !gone.has(t.id));
}

/** A test the Chief AI ruled wrong on a builder's dispute, with her evidence. Kept in the file, never deleted. */
export function withdrawTest(projectDir: string, id: string, evidence: string): void {
  const suite = readAcceptanceTests(projectDir);
  if (!suite || !suite.tests.some((t) => t.id === id) || suite.withdrawn?.some((w) => w.id === id)) return;
  suite.withdrawn = [...(suite.withdrawn ?? []), { id, evidence, at: new Date().toISOString() }];
  saveAcceptanceTests(projectDir, suite);
}

// ── What a builder sees ─────────────────────────────────────────────────────

function apiLine(s: ApiStep, testAs: string): string {
  const who = s.as && s.as !== testAs ? ` as ${s.as}` : "";
  const statuses = Array.isArray(s.expectStatus) ? s.expectStatus.join(" or ") : String(s.expectStatus);
  const body = s.body !== undefined ? ` ${JSON.stringify(s.body)}` : "";
  const checks = (s.expectBody ?? []).map((c) => `${c.path}${c.equals !== undefined ? ` = ${JSON.stringify(c.equals)}` : c.contains !== undefined ? ` contains ${JSON.stringify(c.contains)}` : c.exists === false ? " absent" : " present"}`);
  return `${s.method} ${s.path}${who}${body} → ${statuses}${checks.length ? `; ${checks.join(", ")}` : ""}`;
}

function journeyLine(s: JourneyStep): string {
  switch (s.do) {
    case "open": return `open ${s.path}`;
    case "fill": return `fill "${s.field}" with ${s.value}`;
    case "choose": return `choose "${s.option}" in "${s.field}"`;
    case "click": return `click "${s.text}"`;
    case "see": return `see "${s.text}"`;
    case "notSee": return `do not see "${s.text}"`;
    case "atPath": return `be on ${s.path}`;
  }
}

/** A test's steps, one plain line each. */
export function testSteps(t: AcceptanceTest): string[] {
  return t.steps.map((s, i) => `${i + 1}. ${t.kind === "api" ? apiLine(s as ApiStep, t.as) : journeyLine(s as JourneyStep)}`);
}

/**
 * The phase's tests as a section of a builder's task: the frontend gets the journeys step by step (the labels and button
 * words are what the test looks for) and the API tests in one line each; the backend gets the API tests step by step.
 */
export function acceptanceTestsForPhase(tests: AcceptanceTest[], phase: number | "all", builder: "aanya" | "shubham"): string {
  const mine = phase === "all" ? tests : tests.filter((t) => t.phase === phase);
  if (mine.length === 0) return "";
  const lines: string[] = [];
  for (const t of mine) {
    const head = `${t.id} [${t.planItem}] ${t.title} (as ${t.as})`;
    const detailed = t.kind === "journey" ? builder === "aanya" : builder === "shubham";
    if (!detailed) {
      lines.push(`- ${head}`);
      continue;
    }
    lines.push(`- ${head}:`);
    t.steps.forEach((s, i) => lines.push(`    ${i + 1}. ${t.kind === "api" ? apiLine(s as ApiStep, t.as) : journeyLine(s as JourneyStep)}`));
  }
  return [
    `ACCEPTANCE TESTS FOR THIS ${phase === "all" ? "BUILD" : "PHASE"} (written from the approved plan before the code; you cannot change them; they are run against the running app; the full tests are in ../acceptance-tests.json). Build so they pass: use these exact labels, button words, paths and answers.`,
    ...lines,
  ].join("\n");
}
