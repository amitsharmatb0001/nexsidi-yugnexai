// The fixed acceptance-test runner (2026-10-29, team plan stage 3). No model: it runs the tester's tests
// (acceptance-tests.ts) against the running app — API tests straight against the backend, journeys in the real browser
// through the existing worker (packages/agent-runtime/src/browser). A test it cannot run (the app does not answer, the
// browser cannot start, no account for the role) is "not_checked", never passed or failed. Every run is kept in
// <build>/acceptance-runs.jsonl, the last one in full in <build>/acceptance-results.json.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expandPlaceholders, testContext, type AcceptanceTest, type ApiStep, type BodyCheck, type JourneyStep, type TestContext } from "./acceptance-tests.ts";

export interface BrowserLike {
  send(action: string, args?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  close(): Promise<void>;
}

export interface RunnerAccount {
  email: string;
  password: string;
  token: string;
}

export interface RunnerOptions {
  apiUrl: string;
  appUrl: string;
  /** "user" and each role of the plan; "anyone" needs none */
  accounts: Record<string, RunnerAccount>;
  fetchFn?: typeof fetch;
  /** started on the first journey; the runner closes it when done */
  openBrowser?: () => Promise<BrowserLike>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** how long "see", "notSee" and "atPath" wait for the page (default 8 s) */
  waitMs?: number;
  pollMs?: number;
  /** how long one API request may take before the test is not checked (default 30 s) */
  requestTimeoutMs?: number;
  /** the id of every record a test creates (a POST answered 2xx with an id), for the review's cleanup */
  onCreated?: (id: string) => void;
}

export type TestStatus = "passed" | "failed" | "not_checked";

export interface TestResult {
  id: string;
  phase: number;
  planItem: string;
  title: string;
  status: TestStatus;
  /** the step that failed or could not run (1-based) */
  step?: number;
  detail: string;
  /** how long the test took */
  ms?: number;
}

export interface RunSummary {
  at: string;
  results: TestResult[];
  passed: number;
  failed: number;
  notChecked: number;
}

class Outcome extends Error {
  constructor(readonly status: Exclude<TestStatus, "passed">, readonly step: number | undefined, message: string) {
    super(message);
  }
}
const fail = (step: number, msg: string) => new Outcome("failed", step, msg);
const notChecked = (step: number | undefined, msg: string) => new Outcome("not_checked", step, msg);

const excerpt = (s: string, n = 300) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};
const errText = (err: unknown) => String(err instanceof Error ? err.message : err).split("\n")[0]!.slice(0, 300);

// ── Answers ─────────────────────────────────────────────────────────────────

function at(value: unknown, path: string): { found: boolean; value: unknown } {
  let cur: unknown = value;
  for (const part of path.split(".").filter(Boolean)) {
    if (Array.isArray(cur) && /^\d+$/.test(part)) cur = cur[Number(part)];
    else if (Array.isArray(cur) && part === "length") cur = cur.length;
    else if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[part];
    else return { found: false, value: undefined };
  }
  return { found: true, value: cur };
}

/** A value in the answer; an answer wrapped in {"data": …} is read inside the wrapper too (the generated apps do both). */
export function lookup(body: unknown, path: string): { found: boolean; value: unknown } {
  const direct = at(body, path);
  if (direct.found) return direct;
  if (body && typeof body === "object" && "data" in (body as Record<string, unknown>)) return at((body as Record<string, unknown>).data, path);
  return direct;
}

const numeric = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);

/** Equal, where a number and the same number as text count as equal (Postgres numeric columns arrive as text). */
function looseEqual(a: unknown, b: unknown): boolean {
  const na = numeric(a);
  const nb = numeric(b);
  if (na !== null && nb !== null && (typeof a === "number" || typeof b === "number")) return na === nb;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => looseEqual(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object);
    return ka.length === Object.keys(b as object).length && ka.every((k) => looseEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

function contains(value: unknown, wanted: unknown): boolean {
  if (typeof value === "string") return value.toLowerCase().includes(String(wanted).toLowerCase());
  if (Array.isArray(value)) return value.some((v) => looseEqual(v, wanted) || (typeof v === "string" && contains(v, wanted)) || (v && typeof v === "object" && contains(JSON.stringify(v), wanted)));
  if (value && typeof value === "object") return JSON.stringify(value).toLowerCase().includes(String(wanted).toLowerCase());
  return looseEqual(value, wanted);
}

function checkBody(body: unknown, c: BodyCheck, ctx: TestContext): string | null {
  const { found, value } = lookup(body, c.path);
  const shown = (v: unknown) => (v === undefined ? "missing" : JSON.stringify(v));
  if (c.exists === true && (!found || value === null)) return `${c.path} should be in the answer but is ${shown(value)}`;
  if (c.exists === false && found && value !== null) return `${c.path} should not be in the answer but is ${shown(value)}`;
  if (c.equals !== undefined) {
    const want = expandPlaceholders(c.equals, ctx);
    if (!found || !looseEqual(value, want)) return `${c.path} should equal ${JSON.stringify(want)} but is ${shown(value)}`;
  }
  if (c.contains !== undefined) {
    const want = expandPlaceholders(c.contains, ctx);
    if (!found || !contains(value, want)) return `${c.path} should contain ${JSON.stringify(want)} but is ${shown(value)}`;
  }
  return null;
}

// ── API tests ───────────────────────────────────────────────────────────────

const accountFor = (who: string, opts: RunnerOptions, step: number | undefined): RunnerAccount | undefined => {
  if (who === "anyone") return undefined;
  const a = opts.accounts[who];
  if (!a) throw notChecked(step, `there is no ${who} account in this run, so the test could not be run as ${who}`);
  return a;
};

async function runApiTest(t: AcceptanceTest, opts: RunnerOptions, ctx: TestContext): Promise<string> {
  const fetchFn = opts.fetchFn ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const steps = t.steps as ApiStep[];
  for (let i = 0; i < steps.length; i++) {
    const n = i + 1;
    const s = steps[i]!;
    const account = accountFor(s.as ?? t.as, opts, n);
    const path = String(expandPlaceholders(s.path, ctx));
    const label = `step ${n} (${s.method} ${path})`;
    if (/\{\{[^}]+\}\}/.test(path)) throw notChecked(n, `${label}: a value in the path was never saved`);
    const headers: Record<string, string> = { accept: "application/json" };
    if (s.body !== undefined) headers["content-type"] = "application/json";
    if (account) {
      headers.authorization = `Bearer ${account.token}`;
      headers.cookie = `token=${account.token}`;
    }
    const body = s.body !== undefined ? JSON.stringify(expandPlaceholders(s.body, ctx)) : undefined;
    const limitMs = opts.requestTimeoutMs ?? 30_000;
    // 2026-10-29 (stage 3 proof): a request on a reused connection never reached the app and the run sat for minutes.
    // Each request gets its own connection and a time limit.
    const init = () => ({ method: s.method, headers, keepalive: false, signal: AbortSignal.timeout(limitMs), ...(body !== undefined ? { body } : {}) }) as RequestInit;
    const noAnswer = (err: unknown) =>
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
        ? notChecked(n, `${label}: the app gave no answer within ${limitMs / 1000} s`)
        : notChecked(n, `the app did not answer at ${opts.apiUrl}: ${errText(err)}`);
    let res: Response | undefined;
    let text = "";
    // The app's own rate limit: wait as long as its Retry-After says (plus a second), once.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        res = await fetchFn(opts.apiUrl.replace(/\/+$/, "") + path, init());
        text = await res.text();
      } catch (err) {
        throw noAnswer(err);
      }
      if (res.status !== 429 || attempt === 2) break;
      const seconds = Number(res.headers.get("retry-after"));
      await sleep((Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 120) : 60) * 1000 + 1000);
    }
    if (res!.status === 429) throw notChecked(n, `${label}: the app's rate limit refused the request twice`);
    let answer: unknown = text;
    try {
      answer = JSON.parse(text);
    } catch {
      /* not JSON: kept as text */
    }
    if (s.method === "POST" && res!.status >= 200 && res!.status < 300 && opts.onCreated) {
      const id = lookup(answer, "id");
      if (id.found && (typeof id.value === "string" || typeof id.value === "number")) opts.onCreated(String(id.value));
    }
    const statuses = Array.isArray(s.expectStatus) ? s.expectStatus : [s.expectStatus];
    if (!statuses.includes(res!.status)) throw fail(n, `${label}: expected ${statuses.join(" or ")}, got ${res!.status}${text ? ` — ${excerpt(text)}` : ""}`);
    for (const c of s.expectBody ?? []) {
      const problem = checkBody(answer, c, ctx);
      if (problem) throw fail(n, `${label}: ${problem}`);
    }
    for (const [name, from] of Object.entries(s.save ?? {})) {
      const v = lookup(answer, from);
      if (!v.found || v.value === undefined || v.value === null) throw fail(n, `${label}: the answer has no ${from} to keep as ${name} — ${excerpt(text)}`);
      ctx.saved[name] = v.value;
    }
  }
  return `${steps.length} step${steps.length === 1 ? "" : "s"} passed`;
}

// ── Journeys ────────────────────────────────────────────────────────────────

/** A page path matches when every part is equal, or the expected part is a parameter ([id], :id, {{id}}). */
export function pathMatches(expected: string, actual: string): boolean {
  const parts = (p: string) => (p.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/").split("/");
  const e = parts(expected);
  const a = parts(actual);
  return e.length === a.length && e.every((seg, i) => /^(:|\[|\{|\*)/.test(seg) || /\{\{[^}]*\}\}/.test(seg) || seg.toLowerCase() === a[i]!.toLowerCase());
}

const plain = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

async function runJourney(t: AcceptanceTest, opts: RunnerOptions, ctx: TestContext, browser: BrowserLike): Promise<string> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const waitMs = opts.waitMs ?? 8_000;
  const pollMs = opts.pollMs ?? 400;
  const tries = Math.max(1, Math.ceil(waitMs / pollMs)) + 1;
  const app = opts.appUrl.replace(/\/+$/, "");
  const account = accountFor(t.as, opts, undefined);
  ctx.account = account;
  // A page the app does not serve because the app is down cannot be checked; any other navigation error is the app's.
  const navigate = async (url: string, step: number | undefined) => {
    try {
      return (await browser.send("navigate", { url })) as { status?: number | null };
    } catch (err) {
      if (/ERR_CONNECTION_REFUSED|ECONNREFUSED|ERR_CONNECTION_RESET/i.test(errText(err))) throw notChecked(step, `the app did not answer at ${app}: ${errText(err)}`);
      throw err;
    }
  };
  await browser.send("newSession");
  if (account) {
    // The session cookie the generated apps read (the same way the route sweep signs in).
    await navigate(app, undefined);
    await browser.send("evaluate", { expression: `document.cookie = "token=${account.token}; path=/; SameSite=Strict"` });
  }
  const pageText = async () => String(((await browser.send("getVisibleText")) as { text?: string })?.text ?? "");
  const pagePath = async () => {
    const url = String(((await browser.send("currentUrl")) as { url?: string })?.url ?? "");
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  };
  const steps = t.steps as JourneyStep[];
  for (let i = 0; i < steps.length; i++) {
    const n = i + 1;
    const s = steps[i]!;
    const x = <T>(v: T) => expandPlaceholders(v, ctx) as T;
    try {
      switch (s.do) {
        case "open": {
          const path = x(s.path);
          const r = await navigate(app + path, n);
          if (r?.status && r.status >= 400) throw fail(n, `step ${n}: opening ${path} answered ${r.status}`);
          break;
        }
        case "fill":
          await browser.send("fillField", { field: s.field, value: x(s.value) });
          break;
        case "choose":
          await browser.send("chooseOption", { field: s.field, option: x(s.option) });
          break;
        case "click":
          await browser.send("clickText", { text: x(s.text) });
          break;
        case "see":
        case "notSee": {
          const want = plain(String(x(s.text)));
          let text = "";
          let ok = false;
          for (let k = 0; k < tries; k++) {
            if (k > 0) await sleep(pollMs);
            // A page in the middle of a navigation cannot be read ("Execution context was destroyed"): not yet, read again.
            const read = await pageText().then((v) => ({ v }), () => null);
            if (!read) continue;
            text = read.v;
            if (plain(text).includes(want) === (s.do === "see")) {
              ok = true;
              break;
            }
          }
          if (!ok) {
            const where = await pagePath().catch(() => "the page");
            throw fail(n, s.do === "see"
              ? `step ${n}: did not see "${s.text}" on ${where} within ${Math.round(waitMs / 1000)} s — the page shows: ${excerpt(text, 240) || "(nothing)"}`
              : `step ${n}: "${s.text}" is still on ${where} after ${Math.round(waitMs / 1000)} s`);
          }
          break;
        }
        case "atPath": {
          const want = String(x(s.path));
          let where = "";
          let ok = false;
          for (let k = 0; k < tries; k++) {
            if (k > 0) await sleep(pollMs);
            const read = await pagePath().then((v) => ({ v }), () => null);
            if (!read) continue;
            where = read.v;
            if (pathMatches(want, where)) {
              ok = true;
              break;
            }
          }
          if (!ok) throw fail(n, `step ${n}: expected to be on ${want}, but the browser is on ${where}`);
          break;
        }
        default:
          throw notChecked(n, `step ${n}: the runner does not know the step "${(s as { do?: string }).do}"`);
      }
    } catch (err) {
      if (err instanceof Outcome) throw err;
      // The worker's own words: "no field labelled …", "nothing to click …", a timeout.
      throw fail(n, `step ${n} (${s.do}): ${errText(err)}${s.do === "fill" || s.do === "click" || s.do === "choose" ? ` on ${await pagePath().catch(() => "the page")}` : ""}`);
    }
  }
  return `${steps.length} step${steps.length === 1 ? "" : "s"} passed`;
}

// ── The run ─────────────────────────────────────────────────────────────────

export async function runAcceptanceTests(tests: AcceptanceTest[], opts: RunnerOptions): Promise<RunSummary> {
  const now = opts.now ?? (() => new Date());
  const results: TestResult[] = [];
  let browser: BrowserLike | null = null;
  let browserError: string | null = null;
  try {
    for (const t of tests) {
      const base = { id: t.id, phase: t.phase, planItem: t.planItem, title: t.title };
      const ctx = testContext({ now: now() });
      const started = Date.now();
      try {
        let detail: string;
        if (t.kind === "journey") {
          if (!browser && !browserError) {
            try {
              if (!opts.openBrowser) throw new Error("no browser was given to the runner");
              browser = await opts.openBrowser();
            } catch (err) {
              browserError = errText(err);
            }
          }
          if (!browser) throw notChecked(undefined, `the browser could not start: ${browserError}`);
          detail = await runJourney(t, opts, ctx, browser);
        } else if (t.kind === "api") {
          detail = await runApiTest(t, opts, ctx);
        } else {
          throw notChecked(undefined, `the runner does not know the kind "${String((t as { kind?: unknown }).kind)}"`);
        }
        results.push({ ...base, status: "passed", detail, ms: Date.now() - started });
      } catch (err) {
        if (err instanceof Outcome) results.push({ ...base, status: err.status, ...(err.step ? { step: err.step } : {}), detail: err.message, ms: Date.now() - started });
        else results.push({ ...base, status: "not_checked", detail: `the runner itself failed: ${errText(err)}`, ms: Date.now() - started });
      }
    }
  } finally {
    if (browser) await (browser as BrowserLike).close().catch(() => {});
  }
  return {
    at: now().toISOString(),
    results,
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    notChecked: results.filter((r) => r.status === "not_checked").length,
  };
}

// ── Records ─────────────────────────────────────────────────────────────────

export function recordAcceptanceRun(projectDir: string, run: RunSummary): void {
  writeFileSync(join(projectDir, "acceptance-results.json"), JSON.stringify(run, null, 2));
  appendFileSync(join(projectDir, "acceptance-runs.jsonl"), JSON.stringify({ at: run.at, passed: run.passed, failed: run.failed, notChecked: run.notChecked }) + "\n");
}

export interface AcceptanceFacts {
  runs: number;
  last: { at: string; passed: number; failed: number; notChecked: number; total: number };
}

/** For the success sheet: how many runs there were, and the last one's counts. Null when the tests never ran. */
export function acceptanceFacts(projectDir: string): AcceptanceFacts | null {
  const file = join(projectDir, "acceptance-runs.jsonl");
  if (!existsSync(file)) return null;
  const runs = readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as { at: string; passed: number; failed: number; notChecked: number }];
      } catch {
        return [];
      }
    });
  const last = runs[runs.length - 1];
  if (!last) return null;
  return { runs: runs.length, last: { at: last.at, passed: last.passed, failed: last.failed, notChecked: last.notChecked, total: last.passed + last.failed + last.notChecked } };
}
