// Stage 6 — Deployment: wraps Riya with the deployTarget flag, then re-runs
// Stage 5's adversarial QA against the LIVE deployed URL. This is the "live
// retest" the design doc calls out explicitly — it is what would have caught
// Sprint 1's CORS-origin-mismatch and unmounted-routes bugs immediately,
// since those were deploy-config issues invisible before containers were
// actually running (see design doc, Stage 6 section).
//
// ── Stage 5 live-retest status ──────────────────────────────────────────────
// stage5-adversarial-qa.ts now exists and exports `runStage5(projectId,
// stage4Result): Promise<Stage5Result>`. runStage6()'s default `deps` below
// wraps it via a real dynamic import (`runRealLiveRetest`) — the same
// `await import(...)` pattern stage4-multi-agent-dev.ts uses for its agent
// calls. `runLiveRetestStub` is kept (exported) purely as an opt-in stub for
// callers/tests that want to bypass a real QA re-run — it is no longer the
// default and MUST NOT be reintroduced as the default without a comment
// explaining why real QA coverage is being turned off again.
import { resolveFlags } from "../flags.ts";
import { run as runRiya, type DeployResult } from "../../../agents/riya/src/index.ts";
import { agentForFile, type Stage4Result } from "./stage4-multi-agent-dev.ts";
import type { Stage5Result } from "./stage5-adversarial-qa.ts";
import type { BuildPlan } from "../../../agents/arjun/src/index.ts";
import type { Escalation } from "../../../packages/agent-runtime/src/tools/escalate.ts";
// 2026-07-24 (P2, full agentic upgrade): System B — the subjective live
// evaluator CLAUDE.md documents (design/originality/craft/functionality,
// pass >=7.0). Did not exist before this: runLiveTest (pipeline/activities/
// index.ts) was a hardcoded `return 8.0` stub, zero callers. Wired in here,
// not in Stage 5, because System B needs a real deployed URL to browse —
// the same reason Tier 3 only legitimately runs post-deploy (see
// runRealLiveRetest below).
import { runLiveEval, LIVE_PASS_THRESHOLD, type LiveEvalResult } from "../../../agents/tilotma/src/live-eval.ts";
// 2026-08-05: a cheap, mechanical check for literal spec violations that
// neither System A (bug hunting) nor System B (holistic design judgment) can
// catch — see spec-compliance.ts's header comment for the exact live bug
// (correct colors in generated source, wrong colors in the live render) that
// motivated this. Runs regardless of System B's pass/fail — it is an
// independent, mandatory gate, not a fallback for it.
import { runSpecComplianceCheck, runStackConformanceCheck, toFindings, type SpecComplianceResult } from "./spec-compliance.ts";
import type { ProjectSpec } from "../../../agents/saanvi/src/index.ts";
// 2026-08-05: shared home (pipeline/activities/index.ts's generator
// activities need the identical check for the same reason) — re-exported
// here for backward compat with this file's own tests/callers.
import { isQuotaExhaustionError } from "../../../packages/agent-runtime/src/gemini-loop.ts";
import { dropCodeContradictedFindings } from "../finding-evidence.ts";
import { fixChangedCode } from "./stage5-qa-fix-loop.ts";
import { runAuthSmokeTest } from "./auth-smoke.ts";
import { join as joinPath, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { reviewDbUrl } from "../../../packages/agent-runtime/src/tools/compose-ports.ts";
export { isQuotaExhaustionError };

// Confidentiality Global Constraint (plan + CLAUDE.md): internal agent names
// never appear in anything that could be user-facing. buildDeliverySummary()
// below is the one thing in this stage that produces user-facing output, and
// its own test (stage6-deployment.test.ts) asserts none of these names ever
// appear in what it returns.
const INTERNAL_AGENT_NAMES = [
  "tilotma",
  "saanvi",
  "arjun",
  "vanya",
  "aanya",
  "shubham",
  "pranav",
  "riya",
  "navya",
  "karan",
  "deepika",
] as const;

// 2026-09-28: findings whose claim the project's real source disproves (see
// finding-evidence.ts) are dropped before routing — the live stage has no
// debate, so a false CRITICAL (project a034f90ba50e) went straight to a fixer.
// If that leaves no findings and nothing else failed, the retest passes.
export function guardLiveRetest(projectId: string, retest: LiveRetestResult): LiveRetestResult {
  if (retest.pass || !Array.isArray(retest.findings) || retest.findings.length === 0) return retest;
  const projectDir = joinPath(process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds", projectId);
  const { kept, dropped } = dropCodeContradictedFindings(retest.findings as Array<{ file: string; issue?: string; detail?: string }>, projectDir);
  for (const d of dropped) console.log(`[stage6] dropped finding contradicted by the code (${d.reason}): ${d.finding.file}`);
  if (dropped.length === 0) return retest;
  const othersPass = retest.liveEval?.pass !== false && retest.specCompliance?.pass !== false;
  return { ...retest, findings: kept, pass: kept.length === 0 && othersPass };
}

export interface LiveRetestResult {
  pass: boolean;
  findings: unknown;
  // 2026-07-24 (P2): System B result, when it ran. Optional so existing
  // callers/tests that construct a LiveRetestResult without it (deploy-only
  // stubs, unit tests exercising deploy logic in isolation) are unaffected —
  // buildDeliverySummary only gates on it when present.
  liveEval?: LiveEvalResult;
  // 2026-08-05: literal spec-compliance result, when it ran. Same optionality
  // convention as liveEval above — independent of it, not derived from it.
  specCompliance?: SpecComplianceResult;
}

// 2026-09-29: real bug (project a034f90ba50e). A failed live design review
// (5.95 against a 7.0 pass mark) never became a finding, so the fix loop only
// ever routed the other checks' output and no fixer saw the design critique:
// every fix round changed nothing. The critique goes to the frontend as one
// site-wide finding ({ file: "" } routes to Aanya — see splitLiveFindings).
// Only the reviewer's REASONING is passed on: the evidence list above it is
// tool output, not critique.
export function designFindings(liveEval: LiveEvalResult): Array<{ file: string; issue: string }> {
  if (liveEval.pass) return [];
  const s = liveEval.scores;
  const perCriterion = s
    ? ` (design ${s.designQuality}, originality ${s.originality}, craft ${s.craft}, functionality ${s.functionality})`
    : "";
  const critique = (liveEval.summary.match(/REASONING:\s*([\s\S]*)$/i)?.[1] ?? liveEval.summary).trim().slice(0, 4000);
  return [{
    file: "",
    issue: `Live design review failed: ${liveEval.score.toFixed(2)}/10 against a pass mark of ${LIVE_PASS_THRESHOLD}${perCriterion}. The reviewer's critique of the running app: ${critique}`,
  }];
}

export interface Stage6Result {
  success: boolean;
  appUrl: string;
  findings?: unknown;
  deliverySummary: DeliverySummary;
  // true when consecutive deploy attempts produced identical errors — the
  // pipeline is stuck and retrying won't help (same pattern as Stage 5).
  stuck?: boolean;
}

export interface DeliverySummary {
  status: "delivered" | "failed";
  appUrl: string;
  githubRepo: string | null;
}

// Generic-labeled delivery summary — "URL + repo + feature list" per the
// design doc's Confidentiality table. No QA scores, no iteration counts, no
// agent names. Deterministic and unit-tested directly (see
// stage6-deployment.test.ts) rather than only indirectly through runStage6.
export function buildDeliverySummary(
  deployResult: DeployResult,
  retest: LiveRetestResult,
): DeliverySummary {
  // 2026-07-24 (P2): fail-closed on System B too, when it ran — a site that
  // passes every objective check but scores as generic AI slop must not
  // reach "delivered". `liveEval` is optional so callers that never ran it
  // (deploy-only tests/stubs) aren't gated on something that didn't happen.
  const liveEvalOk = retest.liveEval ? retest.liveEval.pass : true;
  // 2026-08-05: same fail-closed convention — a site System B rates as
  // well-designed can still violate a literal spec fact (wrong color,
  // missing form field). Independent of liveEvalOk: neither gate rescues
  // the other.
  const specComplianceOk = retest.specCompliance ? retest.specCompliance.pass : true;
  return {
    status: deployResult.success && retest.pass && liveEvalOk && specComplianceOk ? "delivered" : "failed",
    appUrl: deployResult.appUrl,
    githubRepo: deployResult.githubRepo,
  };
}

// Opt-in stub — kept for callers/tests that deliberately want to bypass a
// real QA re-run (e.g. exercising deploy-only logic without paying for a
// live LLM run). No longer the default; see `runRealLiveRetest` below and
// the file-header comment.
export async function runLiveRetestStub(projectId: string, appUrl: string): Promise<LiveRetestResult> {
  console.warn(
    `[stage6] Stage 5 live-retest STUBBED for project ${projectId} against ${appUrl} — ` +
      `explicitly bypassing real adversarial QA. This is NOT real QA coverage.`,
  );
  return { pass: true, findings: [] };
}

// Real live-retest: re-runs Stage 5's adversarial QA (Navya/Karan/Deepika +
// Tilotma's Tier 3 evidence review) against the SAME Stage 4 output
// directories now that the app is actually deployed and running at `appUrl`.
// Stage 5's real entry point (runStage5) re-reads code straight off disk
// from stage4Result.backendOutputDir/frontendOutputDir — Riya's deploy does
// not write generated code to a different output directory, it deploys what
// Stage 4 already wrote for this projectId (same BUILD_DIR convention every
// stage uses) — so Stage 4's pre-deploy output dirs are still the correct
// ones to re-scan here; there is no separate post-deploy output dir to
// reconcile.
//
// The one part of Stage 5 that genuinely needs the LIVE url is Tilotma's
// Tier 3 evidence collector — it screenshots a running app
// (agents/tilotma/src/tier3-review.ts) and reads its target from
// `process.env.TIER3_REVIEW_URL` (defaulting to localhost:3000 when unset).
// This wrapper points that env var at the just-deployed `appUrl` for the
// duration of the call and restores whatever was there before, so a live
// retest actually reviews the deployed instance rather than whatever
// TIER3_REVIEW_URL happened to be set to.
// Same BUILD_DIR/projectId/<file> + dynamic-import-of-node:fs convention this
// file already uses for qa-submissions.json reads below (instinct-mismatch
// observation blocks). Throws on a missing/unreadable/malformed file —
// callers (runRealLiveRetest) catch and fail open, since a broken spec.json
// read is this check's own plumbing failing, not a real spec violation.
async function readProjectSpec(projectId: string): Promise<ProjectSpec> {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const buildDir = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";
  const specPath = join(buildDir, projectId, "spec.json");
  return JSON.parse(readFileSync(specPath, "utf-8")) as ProjectSpec;
}

// 2026-08-31: extracted so the reordering's actual decision — skip the two
// expensive, browser-driven stages (Stage 5/Tier 3 + live-eval) when either
// mechanical compliance check already failed — is unit-testable without
// mocking runRealLiveRetest's real docker/LLM orchestration (which is
// deliberately NOT exported/tested for that reason; see this file's own
// header comment on stage6-deployment.test.ts's testing philosophy).
export function shouldSkipExpensiveReview(specComplianceOk: boolean, stackConformanceOk: boolean): boolean {
  return !specComplianceOk || !stackConformanceOk;
}

// 2026-09-29 (project a034f90ba50e): tools/db.ts says Stage 6 sets
// TIER3_DB_URL, but nothing did — every live review reported "db_query
// unavailable" as a finding and could not verify that data really landed.
export function reviewDbUrlForBuild(frontendOutputDir: string): string | null {
  const composePath = joinPath(dirname(frontendOutputDir), "docker-compose.yml");
  return existsSync(composePath) ? reviewDbUrl(readFileSync(composePath, "utf-8")) : null;
}

async function runRealLiveRetest(
  projectId: string,
  appUrl: string,
  backendUrl: string,
  stage4Result: Stage4Result,
  // F5 (agent-autonomy-assessment): same systemContext fan-out as the
  // pre-deployment gate (stage5-qa-fix-loop.ts) — the live retest re-runs
  // the SAME Navya/Karan/Deepika and deserves the same spec/contract/schema
  // context, not just the pre-deploy pass.
  plan?: BuildPlan,
): Promise<LiveRetestResult> {
  const { runStage5 } = await import("./stage5-adversarial-qa.ts");

  // NOTE: an in-process `chromium.launch()` screenshot used to run here. Removed
  // 2026-07-11 — it ran under Bun (the pipeline runtime), where Playwright hangs
  // (root cause of the whole screenshot saga). Tilotma's Tier 3 review, invoked
  // by runStage5 below, now drives the live app via the Node browser worker
  // (packages/agent-runtime/src/browser) and captures its own screenshots.

  const previousUrl = process.env.TIER3_REVIEW_URL;
  const previousBackendUrl = process.env.TIER3_REVIEW_BACKEND_URL;
  process.env.TIER3_REVIEW_URL = appUrl;
  // 2026-07-11: real bug found live — Tier 3 only ever knew the frontend
  // URL, so it tested API endpoints against it and reported a false
  // "no API route" finding. This project's apps use a separate frontend/
  // backend origin; point Tier 3 at Riya's actual backend URL too.
  process.env.TIER3_REVIEW_BACKEND_URL = backendUrl;
  const previousDbUrl = process.env.TIER3_DB_URL;
  const dbUrl = reviewDbUrlForBuild(stage4Result.frontendOutputDir);
  if (dbUrl) process.env.TIER3_DB_URL = dbUrl;
  try {
    // 2026-08-31: reordered to run BEFORE Stage 5 / Tier 3 / live-eval — real
    // live evidence (project 05b590e98102) that these two mechanical checks
    // used to run LAST, after both full Tilotma browser passes (up to
    // ~67 iterations each) and the subjective live-eval pass had already
    // completed. A stack-conformance violation is a package.json string
    // comparison — no browser, no LLM call needed to detect it — so paying
    // for the two most expensive stages in this function first, only to
    // discover the build was going to fail a file-read check anyway, wastes
    // the majority of a Stage 6 attempt's wall-clock time. Fails open on
    // infra/read errors (missing spec.json, a browser worker crash) exactly
    // as before — only a REAL comparison result blocks delivery or skips
    // the expensive stages below.
    let specCompliance: SpecComplianceResult | undefined;
    try {
      const spec = await readProjectSpec(projectId);
      specCompliance = await runSpecComplianceCheck(spec, appUrl);
      if (!specCompliance.pass) {
        console.error(`[stage6] Spec-compliance check FAILED:\n${specCompliance.violations.join("\n")}`);
      }
    } catch (err) {
      console.error(`[stage6] Spec-compliance check could not run — skipping (fail-open): ${String(err)}`);
    }

    // Cheapest of all — pure file read, no live URL needed at all.
    let stackConformance: SpecComplianceResult | undefined;
    try {
      stackConformance = await runStackConformanceCheck(stage4Result.frontendOutputDir);
      if (!stackConformance.pass) {
        console.error(`[stage6] Stack-conformance check FAILED:\n${stackConformance.violations.join("\n")}`);
      }
    } catch (err) {
      console.error(`[stage6] Stack-conformance check could not run — skipping (fail-open): ${String(err)}`);
    }

    // 2026-08-05: BOTH checks above previously blocked `pass` correctly but
    // never contributed to `findings` — the fix loop in runStage6 only ever
    // reads `retest.findings` to decide what to route to fixShubham/fixAanya
    // (splitLiveFindings → agentForFile), so a spec-compliance or stack-
    // conformance failure had no fix path at all: it would just burn through
    // MAX_LIVE_FIX_ATTEMPTS unfixed and end in a stuck failure requiring a
    // human, even though the actual fix (swap a color, remove a banned
    // dependency) is exactly the kind of small, targeted edit runFix already
    // handles well. Merging their violations into `findings` (as
    // Finding-shaped objects — see toFindings) closes that gap: they now
    // route to Aanya via the same agentForFile("frontend/...") path every
    // other frontend finding uses, and get re-verified on the next retest
    // loop iteration exactly like any Navya/Karan/Deepika finding — no full
    // plan/spec rebuild, just a targeted edit to the existing generated files.
    const complianceFindings = [
      ...(specCompliance ? toFindings(specCompliance, "frontend/app/theme-overrides.css") : []),
      ...(stackConformance ? toFindings(stackConformance, "frontend/package.json") : []),
    ];
    const specComplianceOk = specCompliance ? specCompliance.pass : true;
    const stackConformanceOk = stackConformance ? stackConformance.pass : true;

    if (shouldSkipExpensiveReview(specComplianceOk, stackConformanceOk)) {
      // Same "don't spend the expensive stages on a build that's about to
      // loop back anyway" reasoning the old !result.pass early-return below
      // already applied to Stage 5 — now applied one layer earlier, before
      // Stage 5 and liveEval even start, since a compliance failure needs
      // the exact same targeted-fix-and-redeploy cycle regardless of what
      // Stage 5/liveEval would have found.
      return { pass: false, findings: complianceFindings, specCompliance };
    }

    // 2026-10-01: deterministic sign-up -> sign-in -> sign-out check (see
    // auth-smoke.ts). A definite failure skips the expensive review, exactly
    // like the compliance checks above — the fix loop then redeploys and the
    // FULL retest runs again. A skip or pass changes nothing. Off switch:
    // AUTH_SMOKE_TEST=off.
    if (process.env.AUTH_SMOKE_TEST !== "off" && plan) {
      const { BrowserSession } = await import("../../../packages/agent-runtime/src/browser/client.ts");
      const browser = new BrowserSession();
      try {
        const smoke = await runAuthSmokeTest({ appUrl, backendUrl, endpoints: plan.apiContract.endpoints, browser });
        console.log(`[stage6] Auth smoke test: ${smoke.ran ? (smoke.pass ? "passed" : "FAILED") : `skipped (${smoke.skippedReason})`}`);
        if (smoke.ran && !smoke.pass) {
          return { pass: false, findings: smoke.findings.map((issue) => ({ file: "frontend/app", issue: `[auth-smoke] ${issue}` })), specCompliance };
        }
      } finally {
        await browser.close().catch(() => {});
      }
    }

    // includeTier3=true: this runs AFTER a real deploy, pointed at the
    // actual live URL — the one place Tier 3 can legitimately run. See
    // runStage5's own comment for why the pre-deployment gate defaults to
    // false instead.
    const result: Stage5Result = await runStage5(projectId, stage4Result, true, plan);
    if (!result.pass) {
      // Don't spend a live browser evaluation judging the design of an app
      // that's about to loop back for objective bug fixes anyway — System B
      // only runs once System A (findings) + Tier 3 (does it work) agree
      // the app is objectively sound. `liveEval` stays absent here, which
      // buildDeliverySummary treats as "didn't run", not "failed".
      return { pass: result.pass, findings: result.findings, specCompliance };
    }

    // 2026-07-24 (P2): System B — the app is objectively correct; now judge
    // whether it's actually good, not generic AI-slop that happens to work.
    const liveEval = await runLiveEval(projectId, appUrl, stage4Result.frontendOutputDir);

    return {
      pass: result.pass && liveEval.pass,
      findings: [...result.findings, ...designFindings(liveEval)],
      liveEval,
      specCompliance,
    };
  } finally {
    if (previousUrl === undefined) {
      delete process.env.TIER3_REVIEW_URL;
    } else {
      process.env.TIER3_REVIEW_URL = previousUrl;
    }
    if (previousBackendUrl === undefined) {
      delete process.env.TIER3_REVIEW_BACKEND_URL;
    } else {
      process.env.TIER3_REVIEW_BACKEND_URL = previousBackendUrl;
    }
    if (previousDbUrl === undefined) {
      delete process.env.TIER3_DB_URL;
    } else {
      process.env.TIER3_DB_URL = previousDbUrl;
    }
  }
}

// Injectable seam for testing — runStage6() below wraps this with the real
// Riya.run + the real live-retest. Real docker deployment and a real live
// LLM-driven QA re-run are not unit-testable; the deterministic parts this
// stage owns (flag plumbing, fail-fast on deploy failure, delivery summary
// shape) are what stage6-deployment.test.ts covers via injected stubs — none
// of those tests rely on the default, they all pass their own `deps`.
//
// `dbCheckFn` is optional in the interface — existing tests that pass a
// `deps` without it get `undefined`, and the runStage6 body treats that as
// "skip the pre-flight, caller is responsible" (the production default wires
// in the real check; test stubs don't need a real DB to exist).
export interface Stage6Deps {
  // 2026-07-28 (live, complex1): optional 3rd param so the fix-loop's
  // redeploy calls below can request a larger iteration budget than the
  // FIRST deploy — see REDEPLOY_MAX_ITERATIONS' header comment.
  deployFn: (projectId: string, deployTarget: "local" | "gcp", maxIterations?: number) => Promise<DeployResult>;
  liveRetestFn: (projectId: string, appUrl: string, backendUrl: string) => Promise<LiveRetestResult>;
  dbCheckFn?: () => Promise<boolean>;
  // 2026-07-28 (live, complex1): escalations is optional on both — existing
  // DI test stubs (which return only {success}) keep compiling unchanged,
  // matching the same convention stage5-qa-fix-loop.ts's QAFixDeps uses.
  fixShubham?: (plan: BuildPlan, findings: string[]) => Promise<{ success: boolean; escalations?: Escalation[]; filesWritten?: string[] }>;
  fixAanya?: (plan: BuildPlan, findings: string[]) => Promise<{ success: boolean; escalations?: Escalation[]; filesWritten?: string[] }>;
  // 2026-07-28 (live, complex1): the live post-deploy retest previously had
  // NO fix path for db-owned findings at all — a schema finding (e.g.
  // "backend/init.sql: missing index") was either misrouted to shubham (who
  // is instructed to never touch schema files) or silently dropped if it
  // arrived alone. Optional, same convention as fixShubham/fixAanya above;
  // the real entry point wires Pranav's real runFix.
  fixPranav?: (plan: BuildPlan, findings: string[]) => Promise<{ success: boolean; filesWritten?: string[] }>;
  // 2026-08-05: injectable so tests exercising deployWithQuotaRetry's retry
  // path don't actually wait QUOTA_RETRY_BACKOFF_MS (90s) — defaults to a
  // real setTimeout-based sleep in production (deployWithQuotaRetry's own
  // default param), never set by the real entry point below.
  sleepFn?: (ms: number) => Promise<void>;
}

// Pre-flight: verify NexSidi's own pipeline DB is reachable before spending
// agent-loop time on a deploy that will fail at the last step (persisting
// status) when the DB is down. Real bug found live (stress-pro): the entire
// Riya agent loop ran to completion, migration-and-verify passed, round-trip
// passed, then the status UPDATE threw ECONNREFUSED — all that work wasted.
async function checkNexsidiDbReachable(): Promise<boolean> {
  try {
    const { db } = await import("@nexsidi/db");
    const { sql } = await import("drizzle-orm");
    await (db as { execute: (q: unknown) => Promise<unknown> }).execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

// MAX_DEPLOY_ATTEMPTS: try deploy up to 2 times. On a second identical
// failure the loop exits early (stuck) rather than burning more tokens.
// Mirrors Stage 5's stuck-detection at the orchestrator level. 2 is the
// right ceiling: Riya's agent loop already retries internally (up to
// MAX_ITERATIONS); a second Stage-6-level attempt is a genuine re-try with a
// fresh context, not just noise. A third would almost certainly be stuck too.
const MAX_DEPLOY_ATTEMPTS = 2;
const MAX_LIVE_FIX_ATTEMPTS = 3;

// 2026-08-18: real bug found live (gatherly1) — both stuck-detection
// signatures below (errorSignature at the deploy-attempt loop, findingsSig
// at the live-retest fix loop) compared RAW error/finding text, which
// routinely embeds a freshly-random value on every single attempt — a UUID
// from a newly-created test row, e.g. "...did not persist to the database
// (id=8866159a-...)". Since that UUID differs every attempt, neither
// signature ever matched even when the underlying, STRUCTURAL problem was
// 100% identical each time. Confirmed live: the exact same two findings
// (a resource-name/table-name mismatch and a payload-generation gap, both
// in Riya's own verification tooling, not the generated app) recurred
// verbatim — modulo the UUID — across 6 consecutive attempts, burning
// through this file's own two retry loops AND the workflow's own outer
// auto-retry budget (which reads this activity's returned `stuck` flag,
// itself corrupted by the same root cause) before finally, correctly
// escalating. Stripping UUID-shaped substrings before comparing closes all
// three at once, since they all ultimately derive from these two signature
// computations.
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
export function normalizeForStuckComparison(text: string): string {
  return text.replace(UUID_PATTERN, "<id>");
}
const LIVE_STUCK_THRESHOLD = 2;

// 2026-08-05 (live, verify361300): distinguishes a redeploy failure caused by
// transient LLM rate-limit/circuit-breaker exhaustion from a genuine app-level
// deploy failure (bad docker-compose, migration error). Confirmed live: TWO
// consecutive redeploy attempts in the same build both failed on "every model
// in the pool is circuit-broken" (packages/agent-runtime/src/gemini-loop.ts's
// isAllPoolModelsExhaustedError) — the fix loop silently abandoned the rest of
// the live-retest cycle (System B's design/originality judge, and the spec-
// compliance check below) on BOTH attempts, because a redeploy failure
// immediately `break`s out regardless of WHY it failed. A genuine app bug
// won't fix itself by waiting, so it still fails fast as before; quota
// exhaustion is worth waiting out — the shared token bucket refills and
// circuit breakers reopen after packages/llm-client/src/circuit-breaker.ts's
// OPEN_TIMEOUT_MS (60s).
const QUOTA_RETRY_BACKOFF_MS = 90_000;
const MAX_QUOTA_RETRIES = 2;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Runs `deployAttempt` once, then retries (with a backoff wait, up to
// MAX_QUOTA_RETRIES times) ONLY when the failure is quota-exhaustion-shaped —
// any other failure reason returns immediately, unchanged from before.
export async function deployWithQuotaRetry(
  deployAttempt: () => Promise<DeployResult>,
  sleepFn: (ms: number) => Promise<void> = defaultSleep,
  log: (msg: string) => void = console.log,
): Promise<DeployResult> {
  let result = await deployAttempt();
  let retries = 0;
  while (!result.success && isQuotaExhaustionError(result.errors) && retries < MAX_QUOTA_RETRIES) {
    retries++;
    log(
      `[stage6] Deploy failed on LLM quota/circuit-breaker exhaustion — waiting ${QUOTA_RETRY_BACKOFF_MS}ms for recovery before retry ${retries}/${MAX_QUOTA_RETRIES}`,
    );
    await sleepFn(QUOTA_RETRY_BACKOFF_MS);
    result = await deployAttempt();
  }
  return result;
}

// 2026-07-28 (live, complex1): a redeploy INSIDE the fix loop follows a real
// code change and needs to diagnose+fix+rebuild+reverify against a running
// container — a fundamentally bigger task than the FIRST deploy (bring up a
// known-good compose file). See agents/riya/src/index.ts's run() header
// comment for the concrete evidence (a real parameterized-query bug with two
// separate occurrences consumed all 40 default iterations on continuously
// varying tool calls, never repeating — genuine progress cut off, not a
// stuck loop). Only applied to the redeploy call below, not the first deploy.
const REDEPLOY_MAX_ITERATIONS = 70;

function isStage6Deps(value: BuildPlan | Stage6Deps | undefined): value is Stage6Deps {
  return typeof value === "object" && value !== null && "deployFn" in value;
}

// 2026-07-28 (live, complex1): rewritten to route through the SAME
// agentForFile Stage 5's fix loop uses, instead of a second, independent
// backend/frontend-only prefix check. A finding on "backend/init.sql" (a
// real generated project's actual schema-file location) used to fall
// through to the shubham bucket via the old startsWith("backend/") check —
// see agentForFile's header comment in stage4-multi-agent-dev.ts for the
// full root cause and how it produced an unfixable, endlessly-recurring
// finding across every live-retest round.
function splitLiveFindings(findings: unknown): { shubham: string[]; aanya: string[]; pranav: string[] } {
  const groups = { shubham: [] as string[], aanya: [] as string[], pranav: [] as string[] };
  if (!Array.isArray(findings)) return groups;
  for (const finding of findings as Array<{ file?: string; issue?: string; detail?: string }>) {
    const text = finding.issue ?? finding.detail ?? "";
    if (!finding.file) {
      // 2026-08-23: real bug found live (project a355bbb5fa35, nexyug web) —
      // Tier-3 (reality-checker) findings are built as `{ file: "", issue }`
      // (stage5-adversarial-qa.ts's tier3.findings.map), since Tier-3
      // reviews the whole live app, not one file. `!finding.file` is true
      // for "" too, so this branch used to `continue` unconditionally —
      // every Tier-3 finding was silently dropped before ever reaching
      // agentForFile, no matter how real or actionable. Confirmed live: a
      // genuine, confirmed finding ("missing global Header and Footer
      // across all routes") vanished this way, then the fix loop logged
      // "No specific findings to route" and exited without fixing anything,
      // even though a real finding existed. Route to Aanya specifically
      // (not agentForFile("")'s generic shubham default, used elsewhere for
      // a genuinely unfileable/non-actionable case — see
      // stage5-qa-fix-loop.ts's own comment): Tier-3 reviews the RENDERED
      // app, so its findings are almost always frontend/layout/UX, never
      // backend or schema.
      if (text) groups.aanya.push(`(site-wide): ${text}`);
      continue;
    }
    const formatted = `${finding.file}: ${text}`;
    const agent = agentForFile(finding.file) as "shubham" | "aanya" | "pranav";
    if (agent === "shubham" || agent === "aanya" || agent === "pranav") groups[agent].push(formatted);
  }
  return groups;
}

// 2026-10-03 (Ledgerly benchmark run 4): the deploy's own live checks found
// a real app bug — every invoice save returned 500 (the backend used
// ON CONFLICT on a unique constraint the migrations never created). The
// deploy loop only re-ran the identical deploy and stopped as stuck; no
// builder saw the error. Errors that come from the running app itself go to
// the builder that owns that layer. Everything else (a port clash, a docker
// build problem, a test value the app rightly rejected) is the deploy's own
// business and is retried as before.
const SERVER_ERROR = /returned 5\d\d\b/;
const DATABASE_ERROR = /no unique or exclusion constraint|violates (?:foreign key|unique|not-null|check) constraint|(?:relation|column) "?[\w.]+"? does not exist|syntax error at or near|invalid input syntax for type/i;

export function deployErrorsToFindings(errors: string[]): { shubham: string[]; aanya: string[]; pranav: string[] } {
  const groups = { shubham: [] as string[], aanya: [] as string[], pranav: [] as string[] };
  for (const error of errors) {
    if (/migrations did not apply|database has no tables/i.test(error)) {
      groups.pranav.push(`The deployed database has no tables — the migrations did not apply. ${error}`);
    } else if (SERVER_ERROR.test(error) || DATABASE_ERROR.test(error) || error.startsWith("Backend log")) {
      groups.shubham.push(
        `The deployed app failed a live check: ${error}\n` +
        `Reproduce it against your code and the real migrations in ../db/migrations, find the cause and fix it. ` +
        `If the schema itself is wrong, escalate it to the database builder.`,
      );
    }
  }
  return groups;
}

export async function runStage6(
  projectId: string,
  stage4Result: Stage4Result,
  depsOrPlan?: Stage6Deps | BuildPlan,
  planOrUndefined?: BuildPlan,
): Promise<Stage6Result> {
  const flags = resolveFlags();

  let deps: Stage6Deps;
  let plan: BuildPlan | undefined = undefined;

  if (depsOrPlan && "deployFn" in (depsOrPlan as any)) {
    deps = depsOrPlan as Stage6Deps;
    if (planOrUndefined) plan = planOrUndefined;
  } else {
    if (depsOrPlan) plan = depsOrPlan as BuildPlan;
    deps = {
      deployFn: runRiya,
      liveRetestFn: (pid, appUrl, backendUrl) => runRealLiveRetest(pid, appUrl, backendUrl, stage4Result, plan),
      dbCheckFn: checkNexsidiDbReachable,
    };
  }

  // Pre-flight check
  const dbReachable = deps.dbCheckFn ? await deps.dbCheckFn() : true;
  if (!dbReachable) {
    const msg = "NexSidi pipeline database is not reachable — start the DB before running Stage 6";
    console.warn(`[stage6] Pre-flight FAILED: ${msg}`);
    const emptyDeploy: DeployResult = {
      success: false,
      appUrl: "",
      backendUrl: "",
      githubRepo: null,
      errors: [msg],
    };
    return {
      success: false,
      appUrl: "",
      findings: { deployErrors: [msg] },
      deliverySummary: buildDeliverySummary(emptyDeploy, { pass: false, findings: null }),
    };
  }

  const fixShubhamReal = deps.fixShubham ?? (async (p, f) => {
    const { runFix } = await import("../../../agents/generators/shubham/src/index.ts");
    return runFix(p, f);
  });
  const fixAanyaReal = deps.fixAanya ?? (async (p, f) => {
    const { runFix } = await import("../../../agents/generators/aanya/src/index.ts");
    return runFix(p, f);
  });
  const fixPranavReal = deps.fixPranav ?? (async (p, f) => {
    const { runFix } = await import("../../../agents/generators/pranav/src/index.ts");
    return runFix(p, f);
  });

  type FixFn = (p: BuildPlan, f: string[]) => Promise<{ success: boolean; escalations?: Escalation[]; filesWritten?: string[] }>;
  const fixerFor: Record<"shubham" | "aanya" | "pranav", FixFn> = { shubham: fixShubhamReal, aanya: fixAanyaReal, pranav: fixPranavReal };

  // One fix round: every owner with findings fixes in parallel, then any
  // finding a fixer escalated to another owner is fixed in the same round.
  // "nothing_changed" means every fix failed without touching a file, so a
  // redeploy could only reproduce the same result.
  const runOwnerFixes = async (
    fixPlan: BuildPlan,
    routed: { shubham: string[]; aanya: string[]; pranav: string[] },
  ): Promise<"nothing_to_fix" | "nothing_changed" | "changed"> => {
    const owners = (["shubham", "aanya", "pranav"] as const).filter((o) => routed[o].length > 0);
    if (owners.length === 0) return "nothing_to_fix";
    const fixResults = await Promise.all(owners.map((owner) => {
      console.log(`[stage6] Routing ${routed[owner].length} findings to ${owner[0]!.toUpperCase()}${owner.slice(1)}`);
      return fixerFor[owner](fixPlan, routed[owner]).then((r) => ({ agent: owner, ...r }));
    }));
    // 2026-07-26 (autonomy/throughput pass): a fix agent that genuinely
    // failed to complete still triggered a full docker redeploy + retest
    // that could only reproduce the same findings. 2026-09-29: a failed fix
    // that wrote files changed the code (see fixChangedCode) — only skip
    // when nothing was touched.
    if (fixResults.every((r) => !fixChangedCode(r))) {
      console.error(`[stage6] every implicated fix this round failed outright and changed nothing — skipping redeploy, a retest would be wasted`);
      return "nothing_changed";
    }
    if (fixResults.some((r) => !r.success)) {
      console.error(`[stage6] one or more fixes did not finish this round — redeploying anyway since code was changed`);
    }
    // 2026-07-28 / 2026-08-16 (live, complex1, fulfillio1): a fix agent may
    // decide the real fix belongs in another agent's domain
    // (escalate_finding) — routed in this same round, so it lands before
    // the redeploy instead of a whole wasted round later.
    const escalationsByTarget: Record<"shubham" | "aanya" | "pranav", Escalation[]> = { shubham: [], aanya: [], pranav: [] };
    for (const e of fixResults.flatMap((r) => r.escalations ?? [])) escalationsByTarget[e.targetAgent].push(e);
    for (const target of ["shubham", "aanya", "pranav"] as const) {
      const targeted = escalationsByTarget[target];
      if (targeted.length === 0) continue;
      const formatted = targeted.map((e) => `${e.finding} — ${e.reason}`);
      console.log(`[stage6] routing ${formatted.length} escalated finding(s) to ${target} this round`);
      const escalationResult = await fixerFor[target](fixPlan, formatted);
      if (!escalationResult.success) {
        console.error(`[stage6] ${target} escalation fix FAILED to complete`);
      }
    }
    return "changed";
  };

  let deployResult!: DeployResult;
  let prevErrorSignature = "";
  let stuck = false;
  let plainRetries = 0;
  let deployFixRounds = 0;
  let afterFix = false;

  for (let attempt = 1; ; attempt++) {
    deployResult = await deployWithQuotaRetry(
      () => deps.deployFn(projectId, flags.deployTarget, afterFix ? REDEPLOY_MAX_ITERATIONS : undefined),
      deps.sleepFn,
    );

    if (deployResult.success) break;

    const errorSignature = [...deployResult.errors].map(normalizeForStuckComparison).sort().join("\0");
    if (attempt > 1 && prevErrorSignature === errorSignature && errorSignature !== "") {
      stuck = true;
      console.log(
        `[stage6] Stuck: deploy attempt ${attempt} has the identical error list as attempt ${attempt - 1} — stopping rather than retrying`,
      );
      break;
    }
    prevErrorSignature = errorSignature;

    const routed = deployErrorsToFindings(deployResult.errors);
    if (plan && deployFixRounds < MAX_LIVE_FIX_ATTEMPTS && (routed.shubham.length + routed.aanya.length + routed.pranav.length) > 0) {
      deployFixRounds++;
      console.log(`[stage6] Deploy attempt ${attempt} found real app errors — sending them to the builders (fix round ${deployFixRounds} of ${MAX_LIVE_FIX_ATTEMPTS})`);
      const outcome = await runOwnerFixes(plan, routed);
      if (outcome === "changed") {
        afterFix = true;
        console.log(`[stage6] Fixes for the deploy errors are in — deploying again`);
        continue;
      }
      break;
    }

    if (plainRetries + 1 >= MAX_DEPLOY_ATTEMPTS) break;
    plainRetries++;
    afterFix = false;
    console.log(
      `[stage6] Deploy attempt ${attempt} failed — retrying (${MAX_DEPLOY_ATTEMPTS - plainRetries} left): ${deployResult.errors.join("; ").slice(0, 200)}`,
    );
  }

  if (!deployResult.success) {
    return {
      success: false,
      appUrl: deployResult.appUrl,
      findings: { deployErrors: deployResult.errors, ...(stuck ? { stuck: true } : {}) },
      deliverySummary: buildDeliverySummary(deployResult, { pass: false, findings: null }),
      ...(stuck ? { stuck: true } : {}),
    };
  }

  let retest = guardLiveRetest(projectId, await deps.liveRetestFn(projectId, deployResult.appUrl, deployResult.backendUrl));
  let prevFindingsSig = "";
  let fixAttempt = 0;

  while (!retest.pass && fixAttempt < MAX_LIVE_FIX_ATTEMPTS) {
    fixAttempt++;
    console.log(`[stage6] Live retest failed (attempt ${fixAttempt} of ${MAX_LIVE_FIX_ATTEMPTS}) — starting agentic fix loop`);

    const findingsSig = Array.isArray(retest.findings)
      ? [...retest.findings].map(f => normalizeForStuckComparison(`${f.file}:${f.issue || f.detail}`)).sort().join("\0")
      : normalizeForStuckComparison(String(retest.findings));

    if (fixAttempt > 1 && findingsSig === prevFindingsSig) {
      console.log(`[stage6] Stuck loop detected: findings signature did not change on attempt ${fixAttempt}`);
      break;
    }
    prevFindingsSig = findingsSig;

    // Log instinct mismatch if clean QA review missed CRITICAL findings
    try {
      const { readFileSync, existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { buildMismatchObservations, appendInstinctObservations } = await import("../../../packages/agent-runtime/src/instinct-observer.ts");
      
      const buildDir = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";
      const submissionsPath = join(buildDir, projectId, "qa-submissions.json");
      if (existsSync(submissionsPath)) {
        const submissions = JSON.parse(readFileSync(submissionsPath, "utf-8"));
        const laterFindings = Array.isArray(retest.findings) ? retest.findings : [];
        const observations = buildMismatchObservations(submissions, laterFindings);
        if (observations.length > 0) {
          for (const obs of observations) {
            console.log(`[instinct-mismatch] agent ${obs.agentName} submitted 0 findings but later stage found CRITICAL: ${obs.missedFinding}`);
          }
          appendInstinctObservations(observations);
        }
      }
    } catch (obsErr) {
      console.error(`[stage6] Failed to record instinct observations: ${String(obsErr)}`);
    }

    if (plan) {
      const outcome = await runOwnerFixes(plan, splitLiveFindings(retest.findings));
      if (outcome === "nothing_to_fix") {
        console.log(`[stage6] No specific findings to route — exiting fix loop`);
        break;
      }
      if (outcome === "nothing_changed") break;

      console.log(`[stage6] Agent fixes completed — redeploying app via Riya`);

      let redeployResult = await deployWithQuotaRetry(
        () => deps.deployFn(projectId, flags.deployTarget, REDEPLOY_MAX_ITERATIONS),
        deps.sleepFn,
      );
      if (!redeployResult.success) {
        console.error(`[stage6] Redeployment failed: ${redeployResult.errors.join("; ")}`);
        deployResult = redeployResult;
        break;
      }
      deployResult = redeployResult;

      retest = guardLiveRetest(projectId, await deps.liveRetestFn(projectId, deployResult.appUrl, deployResult.backendUrl));
    } else {
      console.warn(`[stage6] No BuildPlan provided — cannot invoke agent fixes. Exiting fix loop.`);
      break;
    }
  }

  // Also log instinct mismatches on final test result if it fails
  if (!retest.pass) {
    try {
      const { readFileSync, existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { buildMismatchObservations, appendInstinctObservations } = await import("../../../packages/agent-runtime/src/instinct-observer.ts");
      
      const buildDir = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";
      const submissionsPath = join(buildDir, projectId, "qa-submissions.json");
      if (existsSync(submissionsPath)) {
        const submissions = JSON.parse(readFileSync(submissionsPath, "utf-8"));
        const laterFindings = Array.isArray(retest.findings) ? retest.findings : [];
        const observations = buildMismatchObservations(submissions, laterFindings);
        if (observations.length > 0) {
          for (const obs of observations) {
            console.log(`[instinct-mismatch] agent ${obs.agentName} submitted 0 findings but later stage found CRITICAL: ${obs.missedFinding}`);
          }
          appendInstinctObservations(observations);
        }
      }
    } catch (obsErr) {
      console.error(`[stage6] Failed to record final instinct observations: ${String(obsErr)}`);
    }
  }

  return {
    success: retest.pass,
    appUrl: deployResult.appUrl,
    findings: retest.findings,
    deliverySummary: buildDeliverySummary(deployResult, retest),
  };
}

// Exported for the test file's confidentiality assertion — keeps the list of
// names to check in one place instead of duplicating it in the test.
export { INTERNAL_AGENT_NAMES };
