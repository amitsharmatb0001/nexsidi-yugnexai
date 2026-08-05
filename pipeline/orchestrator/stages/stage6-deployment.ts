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
import { runLiveEval, type LiveEvalResult } from "../../../agents/tilotma/src/live-eval.ts";
// 2026-08-05: a cheap, mechanical check for literal spec violations that
// neither System A (bug hunting) nor System B (holistic design judgment) can
// catch — see spec-compliance.ts's header comment for the exact live bug
// (correct colors in generated source, wrong colors in the live render) that
// motivated this. Runs regardless of System B's pass/fail — it is an
// independent, mandatory gate, not a fallback for it.
import { runSpecComplianceCheck, runStackConformanceCheck, toFindings, type SpecComplianceResult } from "./spec-compliance.ts";
import type { ProjectSpec } from "../../../agents/saanvi/src/index.ts";

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
  const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
  const specPath = join(buildDir, projectId, "spec.json");
  return JSON.parse(readFileSync(specPath, "utf-8")) as ProjectSpec;
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
  try {
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
      return { pass: result.pass, findings: result.findings };
    }

    // 2026-07-24 (P2): System B — the app is objectively correct; now judge
    // whether it's actually good, not generic AI-slop that happens to work.
    const liveEval = await runLiveEval(projectId, appUrl, stage4Result.frontendOutputDir);

    // 2026-08-05: independent of liveEval's outcome (see spec-compliance.ts's
    // header comment) — a literal spec fact (color, required form field) can
    // be wrong even when System B rates the design as competent on its own
    // terms. Fails open on infra/read errors (missing spec.json, a browser
    // worker crash) rather than blocking delivery on this check's own
    // plumbing breaking — only a REAL comparison result blocks delivery.
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

    // 2026-08-05: same reasoning as spec-compliance above, but for the FIXED
    // global stack rule (Next.js + @yugnex/nexui-react, no Tailwind/shadcn/
    // @radix-ui) rather than a per-project spec fact — see spec-compliance.ts's
    // "Stack conformance" section header comment. Source-file check (reads
    // package.json), not live — no browser worker needed, so failures here
    // are almost always a real violation, not infra flakiness; still fails
    // open on a read error for the same reason as above.
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
    const findings = complianceFindings.length > 0 ? [...result.findings, ...complianceFindings] : result.findings;

    const specComplianceOk = specCompliance ? specCompliance.pass : true;
    const stackConformanceOk = stackConformance ? stackConformance.pass : true;
    return {
      pass: result.pass && liveEval.pass && specComplianceOk && stackConformanceOk,
      findings,
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
  fixShubham?: (plan: BuildPlan, findings: string[]) => Promise<{ success: boolean; escalations?: Escalation[] }>;
  fixAanya?: (plan: BuildPlan, findings: string[]) => Promise<{ success: boolean; escalations?: Escalation[] }>;
  // 2026-07-28 (live, complex1): the live post-deploy retest previously had
  // NO fix path for db-owned findings at all — a schema finding (e.g.
  // "backend/init.sql: missing index") was either misrouted to shubham (who
  // is instructed to never touch schema files) or silently dropped if it
  // arrived alone. Optional, same convention as fixShubham/fixAanya above;
  // the real entry point wires Pranav's real runFix.
  fixPranav?: (plan: BuildPlan, findings: string[]) => Promise<{ success: boolean }>;
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
export function isQuotaExhaustionError(errors: string[]): boolean {
  return errors.some((e) => /circuit-broken|all pool models exhausted|RESOURCE_EXHAUSTED/i.test(e));
}

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
    if (!finding.file) continue;
    const text = finding.issue ?? finding.detail ?? "";
    const formatted = `${finding.file}: ${text}`;
    const agent = agentForFile(finding.file) as "shubham" | "aanya" | "pranav";
    if (agent === "shubham" || agent === "aanya" || agent === "pranav") groups[agent].push(formatted);
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

  let deployResult!: DeployResult;
  let prevErrorSignature = "";
  let stuck = false;

  for (let attempt = 1; attempt <= MAX_DEPLOY_ATTEMPTS; attempt++) {
    deployResult = await deployWithQuotaRetry(
      () => deps.deployFn(projectId, flags.deployTarget),
      deps.sleepFn,
    );

    if (deployResult.success) break;

    const errorSignature = [...deployResult.errors].sort().join("\0");
    if (attempt > 1 && prevErrorSignature === errorSignature && errorSignature !== "") {
      stuck = true;
      console.log(
        `[stage6] Stuck: deploy attempt ${attempt} has the identical error list as attempt ${attempt - 1} — stopping rather than retrying`,
      );
      break;
    }
    prevErrorSignature = errorSignature;

    if (attempt < MAX_DEPLOY_ATTEMPTS) {
      console.log(
        `[stage6] Deploy attempt ${attempt} failed — retrying (${MAX_DEPLOY_ATTEMPTS - attempt} left): ${deployResult.errors.join("; ").slice(0, 200)}`,
      );
    }
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

  let retest = await deps.liveRetestFn(projectId, deployResult.appUrl, deployResult.backendUrl);
  let prevFindingsSig = "";
  let fixAttempt = 0;

  while (!retest.pass && fixAttempt < MAX_LIVE_FIX_ATTEMPTS) {
    fixAttempt++;
    console.log(`[stage6] Live retest failed (attempt ${fixAttempt} of ${MAX_LIVE_FIX_ATTEMPTS}) — starting agentic fix loop`);

    const findingsSig = Array.isArray(retest.findings) 
      ? [...retest.findings].map(f => `${f.file}:${f.issue || f.detail}`).sort().join("\0")
      : String(retest.findings);

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
      
      const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
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

    const { shubham: shubhamFindings, aanya: aanyaFindings, pranav: pranavFindings } = splitLiveFindings(retest.findings);

    if (plan) {
      const fixCalls: Promise<{ agent: string; success: boolean; escalations?: Escalation[] }>[] = [];
      if (shubhamFindings.length > 0) {
        console.log(`[stage6] Routing ${shubhamFindings.length} findings to Shubham`);
        fixCalls.push(fixShubhamReal(plan, shubhamFindings).then((r) => ({ agent: "shubham", ...r })));
      }
      if (aanyaFindings.length > 0) {
        console.log(`[stage6] Routing ${aanyaFindings.length} findings to Aanya`);
        fixCalls.push(fixAanyaReal(plan, aanyaFindings).then((r) => ({ agent: "aanya", ...r })));
      }
      // 2026-07-28 (live, complex1): db-owned findings (e.g. "backend/init.sql:
      // missing index") now get a real fix path instead of being misrouted to
      // shubham or silently dropped — see splitLiveFindings' header comment.
      if (pranavFindings.length > 0) {
        console.log(`[stage6] Routing ${pranavFindings.length} findings to Pranav`);
        fixCalls.push(fixPranavReal(plan, pranavFindings).then((r) => ({ agent: "pranav", ...r })));
      }

      if (fixCalls.length > 0) {
        // 2026-07-26 (autonomy/throughput pass): same root cause fixed in
        // stage5-qa-fix-loop.ts, at this second boundary — the {success}
        // result was discarded, so a fix agent that genuinely failed to
        // complete (rather than completing but not fully resolving the
        // issue) still triggered a full docker redeploy + live-retest
        // cycle that could only reproduce the exact same findings.
        const fixResults = await Promise.all(fixCalls);
        const anyFixFailed = fixResults.some((r) => !r.success);
        if (anyFixFailed && fixResults.every((r) => !r.success)) {
          console.error(`[stage6] every implicated fix this round failed outright — skipping redeploy, a retest would be wasted`);
          break;
        }
        if (anyFixFailed) {
          console.error(`[stage6] one or more fixes failed outright this round — redeploying anyway since at least one agent's fix may have succeeded`);
        }

        // 2026-07-28 (live, complex1): mirrors stage5-qa-fix-loop.ts's same
        // escalation routing — a fix agent may decide the real fix belongs
        // in Pranav's domain (escalate_finding) instead of forcing a
        // workaround in its own. Dispatched in THIS SAME round so a schema
        // fix lands before the redeploy below, not a full wasted round later.
        const pranavEscalations = fixResults.flatMap((r) => r.escalations ?? []).filter((e) => e.targetAgent === "pranav");
        if (pranavEscalations.length > 0) {
          const formatted = pranavEscalations.map((e) => `${e.finding} — ${e.reason}`);
          console.log(`[stage6] routing ${formatted.length} escalated finding(s) to Pranav this round`);
          const escalationResult = await fixPranavReal(plan, formatted);
          if (!escalationResult.success) {
            console.error(`[stage6] pranav escalation fix FAILED to complete`);
          }
        }

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

        retest = await deps.liveRetestFn(projectId, deployResult.appUrl, deployResult.backendUrl);
      } else {
        console.log(`[stage6] No specific findings to route — exiting fix loop`);
        break;
      }
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
      
      const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
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
