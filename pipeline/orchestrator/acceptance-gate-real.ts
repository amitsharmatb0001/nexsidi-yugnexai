// The real steps behind the acceptance gate (acceptance-gate.ts): the deploy step's fast path starts the app, test
// accounts come from the app's own sign-up (roles given on the reserved test domain, as in the live review), the fixed
// runner runs the tests, the builders' fix runs carry the "test passes" finish check, and the Chief AI rules on disputes.
// One rebuild at a time: two fix runs finishing together must not run `docker compose up --build` at once.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BuildPlan } from "../../agents/arjun/src/index.ts";
import { run as runRiya, redeployRunningApp, grantTestAccountRole, limitedRolesFromContract, recordSeededRecords, purgeVerificationArtifacts, databaseNow } from "../../agents/riya/src/index.ts";
import { createReviewAccount } from "./stages/route-sweep.ts";
import { resetAppRateLimits } from "./stages/limiter-reset.ts";
import { runAcceptanceTests, recordAcceptanceRun, type RunnerAccount } from "./acceptance-runner.ts";
import { acceptanceFixCheck, type GateDeps, type GateUrls, type Owner } from "./acceptance-gate.ts";
import { activeTests, readAcceptanceTests, type AcceptanceTest } from "./acceptance-tests.ts";
import { resolveDisputes } from "./disputes.ts";
import { buildDirFor } from "../../packages/agent-runtime/src/build-dir.ts";
import { openCustomerQuestions } from "../../packages/agent-runtime/src/tools/ask.ts";

/** Runs jobs one after another, in the order they asked. */
export function oneAtATime(): <T>(job: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>) => {
    const next = tail.then(job, job);
    tail = next.catch(() => undefined);
    return next;
  };
}

/** One ordinary account ("user") and one per role the contract limits pages to, all on the reserved test domain. */
export async function createTestAccounts(
  projectDir: string,
  backendUrl: string,
  endpoints: Array<{ method: string; path: string; description?: string }>,
): Promise<{ accounts: Record<string, RunnerAccount>; notes: string[] }> {
  const accounts: Record<string, RunnerAccount> = {};
  const notes: string[] = [];
  const user = await createReviewAccount({ backendUrl, endpoints, label: "accept" });
  if ("reason" in user) notes.push(`user account: ${user.reason}`);
  else accounts.user = user;
  for (const role of limitedRolesFromContract(endpoints)) {
    let grant: { ok: true } | { reason: string } = { reason: "the account was not created" };
    const ra = await createReviewAccount({ backendUrl, endpoints, label: `accept${role}`, beforeLogin: (email) => { grant = grantTestAccountRole(projectDir, email, role); } });
    if ("reason" in ra) notes.push(`${role} account: ${ra.reason}`);
    else if ("reason" in grant) notes.push(`${role} account: the role could not be given (${(grant as { reason: string }).reason})`);
    else accounts[role] = ra;
  }
  return { accounts, notes };
}

const TEST_ID = /\bAT-\d+-\d+\b/g;

/** The tests a text names by id. */
function testsNamedIn(texts: string[], projectDir: string): AcceptanceTest[] {
  const ids = new Set(texts.flatMap((t) => t.match(TEST_ID) ?? []));
  return activeTests(readAcceptanceTests(projectDir)).filter((t) => ids.has(t.id));
}

export function realGateDeps(projectId: string, plan: BuildPlan): { deps: GateDeps; cleanup(): Promise<void> } {
  const dir = buildDirFor(projectId);
  const serial = oneAtATime();
  let accounts: Record<string, RunnerAccount> | null = null;
  let current: GateUrls | null = null;
  let testingStartedAt: string | null = null;

  const runTests = async (tests: AcceptanceTest[], urls: GateUrls) => {
    // The app's sign-up/sign-in limiter counts in memory; the tests sign up and sign in, so they start with fresh counters.
    await resetAppRateLimits(dir, urls.backendUrl).catch(() => undefined);
    if (!accounts) {
      const made = await createTestAccounts(dir, urls.backendUrl, plan.apiContract.endpoints);
      for (const n of made.notes) console.warn(`[acceptance-gate] ${n}`);
      accounts = made.accounts;
    }
    const { BrowserSession } = await import("../../packages/agent-runtime/src/browser/client.ts");
    return runAcceptanceTests(tests, {
      apiUrl: urls.backendUrl,
      appUrl: urls.appUrl,
      accounts,
      openBrowser: async () => new BrowserSession(),
      onCreated: (id) => recordSeededRecords(dir, { acceptance: [id] }),
    });
  };

  const fixWith = async (owner: Owner, findings: string[], tests: AcceptanceTest[], sinceIso: string, urls: GateUrls) => {
    const check = {
      exitChecks: () => acceptanceFixCheck(projectId, tests, { redeploy: () => serial(() => redeployRunningApp(dir, urls.appUrl, urls.backendUrl)), run: (ts) => runTests(ts, urls) }, sinceIso),
    };
    if (owner === "pranav") {
      const { runFix } = await import("../../agents/generators/pranav/src/index.ts");
      const r = await runFix(plan, findings);
      return { success: r.success, files: r.filesWritten, escalations: r.escalations ?? [] };
    }
    const { runFix } = owner === "shubham" ? await import("../../agents/generators/shubham/src/index.ts") : await import("../../agents/generators/aanya/src/index.ts");
    const r = await runFix(plan, findings, undefined, check);
    return { success: r.success, files: r.filesWritten, escalations: r.escalations ?? [] };
  };

  const deps: GateDeps = {
    deploy: async () => {
      const r = await serial(() => runRiya(projectId));
      if (!r.success) return { reason: r.errors.join("; ").slice(0, 600) || "the deploy step failed" };
      current = { appUrl: r.appUrl, backendUrl: r.backendUrl };
      testingStartedAt ??= databaseNow(dir);
      return current;
    },
    run: async (tests, urls) => {
      const run = await runTests(tests, urls);
      recordAcceptanceRun(dir, run);
      return run;
    },
    fix: async (owner, findings, tests, ctx) => {
      const r = await fixWith(owner, findings, tests, ctx.sinceIso, ctx.urls);
      return { filesWritten: r.files.length, escalations: r.escalations };
    },
    settle: async (sinceIso) => {
      const { settleDisputes } = await import("../../agents/tilotma/src/settle-disputes.ts");
      const urls = current;
      const refix = (owner: Owner) => async (_p: BuildPlan, f: string[]) => {
        if (!urls) return { success: false, filesWritten: [] as string[] };
        const r = await fixWith(owner, f, testsNamedIn(f, dir), sinceIso, urls);
        return { success: r.success, filesWritten: r.files };
      };
      await resolveDisputes(projectId, sinceIso, plan, {
        settle: (pid, disputes) => settleDisputes(pid, disputes, { reviewRoot: dir, appUrl: urls?.appUrl, backendUrl: urls?.backendUrl }),
        fixers: { shubham: refix("shubham"), aanya: refix("aanya"), pranav: refix("pranav") },
      });
      // The disputes she ruled not true this round: a test ruled wrong is withdrawn.
      const file = join(dir, "settled-not-true.jsonl");
      const withdrawn: Array<{ id: string; evidence: string }> = [];
      if (existsSync(file)) {
        for (const line of readFileSync(file, "utf-8").split(/\r?\n/).filter(Boolean)) {
          try {
            const s = JSON.parse(line) as { finding?: string; evidence?: string; at?: string };
            if (!s.at || s.at < sinceIso || !/\[acceptance AT-/.test(s.finding ?? "")) continue;
            for (const id of new Set(s.finding!.match(TEST_ID) ?? [])) withdrawn.push({ id, evidence: s.evidence ?? "" });
          } catch {
            /* a torn line is skipped */
          }
        }
      }
      return { withdrawn };
    },
    openQuestions: () => openCustomerQuestions(projectId).length > 0,
  };

  return {
    deps,
    // The test accounts, everything under them and every record the tests created are removed; the limiter is reset so
    // the review that follows (and the customer) starts fresh.
    cleanup: async () => {
      purgeVerificationArtifacts(dir, testingStartedAt);
      if (current) await resetAppRateLimits(dir, current.backendUrl).catch(() => undefined);
    },
  };
}
