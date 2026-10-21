// The live check an Express Build must pass before it is called delivered, and the repair loop around it.
//
// The delivery smoke check only proves pages answer and the frontend points at its own API. It cannot see a page that
// crashes once it has real data, a form the backend rejects, or a request that fails after sign-in (seen live: a plant
// page that crashed with "a is not iterable", a due date the API refused). A full build runs the pipeline's own live
// check for exactly that: a real browser, a test account with sample data, every page signed out and signed in. This
// runs the same check on an Express Build, repairs what it finds, and checks again.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Strategy } from "./strategies.ts";

export interface LiveFinding {
  file: string;
  issue: string;
}

export interface LiveCheckResult {
  ran: boolean;
  pass: boolean;
  findings: LiveFinding[];
  notChecked: string[];
}

// A layout note seen only at phone width is worth reporting but does not stop a delivery, and is often the base app's own.
const PHONE_ONLY = /\bon a phone\b/;

/** The findings that break the app. */
export function blockingFindings(findings: LiveFinding[]): LiveFinding[] {
  return findings.filter((x) => !PHONE_ONLY.test(x.issue));
}

/** What the editing steps are told: what testing the running app showed, page by page, with the evidence. */
export function repairRequest(findings: LiveFinding[], strategy?: Strategy): string {
  const lines = findings.map((x, i) => `${i + 1}. ${x.issue} (in ${x.file})`);
  return [
    "Testing the running app (a real browser, a test account with sample data) found these problems. Fix each one at its cause.",
    "",
    ...lines,
    "",
    ...(strategy
      ? [`The previous attempt did not fix this. Use a different approach this time: ${strategy.title}. ${strategy.instruction}`, ""]
      : []),
    "Change nothing else. Do not remove or rewrite working features to make a problem disappear.",
  ].join("\n");
}

// The same problem seen twice differs in ids that change between runs (a sample record's id, a port); this removes them.
const stableKey = (issue: string) =>
  issue
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/localhost:\d+/g, "localhost:<port>")
    .replace(/\s+/g, " ")
    .trim();

export interface VerifyDeps {
  liveCheck: () => Promise<LiveCheckResult>;
  /** Applies fixes for the findings to the code and redeploys. Throws when the repaired app cannot be brought up. */
  repair: (findings: LiveFinding[], strategy?: Strategy) => Promise<void>;
  /** Asked for a different approach when the same problem comes back after a repair. `tried` are the ids already used. */
  alternative?: (findings: LiveFinding[], tried: string[]) => Promise<Strategy | null>;
  maxRepairs?: number;
}

export interface VerifyResult {
  pass: boolean;
  rounds: number;
  findings: LiveFinding[];
  notChecked: string[];
  repairError?: string;
}

/** Check, repair what is wrong, check again — up to maxRepairs times (default 2). A problem that comes back gets a different approach. */
export async function verifyAndRepair(deps: VerifyDeps): Promise<VerifyResult> {
  const maxRepairs = deps.maxRepairs ?? 2;
  let rounds = 0;
  let previous = new Set<string>();
  const tried: string[] = [];
  for (;;) {
    const result = await deps.liveCheck();
    const blocking = blockingFindings(result.findings);
    if (blocking.length === 0) return { pass: true, rounds, findings: [], notChecked: result.notChecked };
    if (rounds >= maxRepairs) return { pass: false, rounds, findings: blocking, notChecked: result.notChecked };
    const keys = new Set(blocking.map((x) => stableKey(x.issue)));
    const cameBack = [...keys].some((k) => previous.has(k));
    previous = keys;
    rounds += 1;
    try {
      let strategy: Strategy | undefined;
      if (cameBack && deps.alternative) {
        strategy = (await deps.alternative(blocking, [...tried])) ?? undefined;
        if (strategy) tried.push(strategy.id);
      }
      await deps.repair(blocking, strategy);
    } catch (err) {
      return { pass: false, rounds, findings: blocking, notChecked: result.notChecked, repairError: String(err instanceof Error ? err.message : err) };
    }
  }
}

// ── the live check itself ───────────────────────────────────────────────────

export interface LiveCheckOptions {
  buildDir: string;
  frontendDir: string;
  appUrl: string;
  backendUrl: string;
}

type Endpoints = Array<{ method: string; path: string }>;

export interface LiveCheckDeps {
  snapshot: (buildDir: string) => Record<string, number> | null;
  createAccount: () => Promise<{ email: string; password: string; token: string } | { reason: string }>;
  seed: (token: string) => Promise<{ created: Record<string, string[]>; notSeeded: string[] }>;
  authSmoke: () => Promise<{ ran: boolean; pass: boolean; findings: string[]; skippedReason?: string | null }>;
  sweep: (
    session: { token: string } | undefined,
    seed: (() => Promise<{ created: Record<string, string[]>; notSeeded: string[] }>) | undefined,
  ) => Promise<{ ran: boolean; pass: boolean; findings: LiveFinding[]; notChecked: string[]; visited: number; seeded: Record<string, string[]> }>;
  purge: (buildDir: string) => void;
  compare: (before: Record<string, number>, after: Record<string, number>) => string[];
  endpoints: Endpoints;
}

async function realDeps(opts: LiveCheckOptions): Promise<LiveCheckDeps> {
  const riya = await import("../../agents/riya/src/index.ts");
  const { createReviewAccount, runRouteSweepReal } = await import("./stages/route-sweep.ts");
  const { runAuthSmokeTest } = await import("./stages/auth-smoke.ts");
  const { BrowserSession } = await import("../../packages/agent-runtime/src/browser/client.ts");
  let endpoints: Endpoints = [];
  const contractPath = join(opts.buildDir, "api-contract.json");
  if (existsSync(contractPath)) {
    try {
      endpoints = (JSON.parse(readFileSync(contractPath, "utf-8")).endpoints ?? []) as Endpoints;
    } catch {
      /* an unreadable contract means the account and sample data are skipped, and the check says so */
    }
  }
  return {
    snapshot: riya.snapshotTableCounts,
    createAccount: () => createReviewAccount({ backendUrl: opts.backendUrl, endpoints }),
    seed: (token) => riya.seedSampleData(opts.buildDir, opts.backendUrl, token, 2),
    authSmoke: async () => {
      const browser = new BrowserSession();
      try {
        return await runAuthSmokeTest({ appUrl: opts.appUrl, backendUrl: opts.backendUrl, endpoints, browser });
      } finally {
        await browser.close().catch(() => {});
      }
    },
    sweep: (session, seed) => runRouteSweepReal(opts.frontendDir, opts.appUrl, opts.backendUrl, endpoints, seed, session),
    purge: riya.purgeVerificationArtifacts,
    compare: riya.compareSnapshots,
    endpoints,
  };
}

/**
 * Signs up in a real browser, makes a test account with sample data, opens every page signed out and signed in, then
 * removes every test row and confirms the tables hold what they held before. The clean-up always runs.
 */
export async function runLiveCheck(opts: LiveCheckOptions, deps?: LiveCheckDeps): Promise<LiveCheckResult> {
  const d = deps ?? (await realDeps(opts));
  const findings: LiveFinding[] = [];
  const notChecked: string[] = [];
  const baseline = d.snapshot(opts.buildDir);
  let ran = false;
  try {
    const smoke = await d.authSmoke();
    if (smoke.ran) {
      ran = true;
      if (!smoke.pass) for (const issue of smoke.findings) findings.push({ file: "frontend/app", issue: `[auth-smoke] ${issue}` });
    } else if (smoke.skippedReason && !/has no sign-up and sign-in endpoints/.test(smoke.skippedReason)) {
      notChecked.push(`sign-up/sign-in check: ${smoke.skippedReason}`);
    }

    let session: { token: string } | undefined;
    let seed: (() => Promise<{ created: Record<string, string[]>; notSeeded: string[] }>) | undefined;
    const account = await d.createAccount();
    if ("reason" in account) {
      notChecked.push(`sample data and signed-in pages: ${account.reason}`);
    } else {
      session = { token: account.token };
      const made = await d.seed(account.token);
      notChecked.push(...made.notSeeded);
      seed = async () => ({ created: made.created, notSeeded: [] });
    }

    const sweep = await d.sweep(session, seed);
    if (sweep.ran) ran = true;
    findings.push(...sweep.findings);
    notChecked.push(...sweep.notChecked);
  } catch (err) {
    findings.push({ file: "app", issue: `[live-check] the check could not finish: ${String(err instanceof Error ? err.message : err).slice(0, 220)}` });
  } finally {
    d.purge(opts.buildDir);
    const after = d.snapshot(opts.buildDir);
    if (baseline && after) {
      for (const line of d.compare(baseline, after)) findings.push({ file: "database", issue: `[live-check] test data left in the database after the clean-up — ${line}` });
    }
  }
  return { ran, pass: findings.length === 0, findings, notChecked };
}
