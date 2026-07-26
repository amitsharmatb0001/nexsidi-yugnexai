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
import type { Stage4Result } from "./stage4-multi-agent-dev.ts";
import type { Stage5Result } from "./stage5-adversarial-qa.ts";
import type { BuildPlan } from "../../../agents/arjun/src/index.ts";
// 2026-07-24 (P2, full agentic upgrade): System B — the subjective live
// evaluator CLAUDE.md documents (design/originality/craft/functionality,
// pass >=7.0). Did not exist before this: runLiveTest (pipeline/activities/
// index.ts) was a hardcoded `return 8.0` stub, zero callers. Wired in here,
// not in Stage 5, because System B needs a real deployed URL to browse —
// the same reason Tier 3 only legitimately runs post-deploy (see
// runRealLiveRetest below).
import { runLiveEval, type LiveEvalResult } from "../../../agents/tilotma/src/live-eval.ts";

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
  return {
    status: deployResult.success && retest.pass && liveEvalOk ? "delivered" : "failed",
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
async function runRealLiveRetest(
  projectId: string,
  appUrl: string,
  backendUrl: string,
  stage4Result: Stage4Result,
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
    const result: Stage5Result = await runStage5(projectId, stage4Result, true);
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
    return { pass: result.pass && liveEval.pass, findings: result.findings, liveEval };
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
  deployFn: (projectId: string, deployTarget: "local" | "gcp") => Promise<DeployResult>;
  liveRetestFn: (projectId: string, appUrl: string, backendUrl: string) => Promise<LiveRetestResult>;
  dbCheckFn?: () => Promise<boolean>;
  fixShubham?: (plan: BuildPlan, findings: string[]) => Promise<{ success: boolean }>;
  fixAanya?: (plan: BuildPlan, findings: string[]) => Promise<{ success: boolean }>;
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

function isStage6Deps(value: BuildPlan | Stage6Deps | undefined): value is Stage6Deps {
  return typeof value === "object" && value !== null && "deployFn" in value;
}

function splitLiveFindings(findings: unknown): { shubham: string[]; aanya: string[] } {
  const groups = { shubham: [] as string[], aanya: [] as string[] };
  if (!Array.isArray(findings)) return groups;
  for (const finding of findings as Array<{ file?: string; issue?: string; detail?: string }>) {
    const text = finding.issue ?? finding.detail ?? "";
    const formatted = finding.file ? `${finding.file}: ${text}` : text;
    if (finding.file?.startsWith("frontend/")) groups.aanya.push(formatted);
    if (finding.file?.startsWith("backend/")) groups.shubham.push(formatted);
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
      liveRetestFn: (pid, appUrl, backendUrl) => runRealLiveRetest(pid, appUrl, backendUrl, stage4Result),
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
    deployResult = await deps.deployFn(projectId, flags.deployTarget);

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

    const { shubham: shubhamFindings, aanya: aanyaFindings } = splitLiveFindings(retest.findings);

    if (plan) {
      const fixPromises: Promise<any>[] = [];
      if (shubhamFindings.length > 0) {
        console.log(`[stage6] Routing ${shubhamFindings.length} findings to Shubham`);
        fixPromises.push(fixShubhamReal(plan, shubhamFindings));
      }
      if (aanyaFindings.length > 0) {
        console.log(`[stage6] Routing ${aanyaFindings.length} findings to Aanya`);
        fixPromises.push(fixAanyaReal(plan, aanyaFindings));
      }

      if (fixPromises.length > 0) {
        await Promise.all(fixPromises);
        console.log(`[stage6] Agent fixes completed — redeploying app via Riya`);

        let redeployResult = await deps.deployFn(projectId, flags.deployTarget);
        if (!redeployResult.success) {
          console.error(`[stage6] Redeployment failed: ${redeployResult.errors.join("; ")}`);
          deployResult = redeployResult;
          break;
        }
        deployResult = redeployResult;

        retest = await deps.liveRetestFn(projectId, deployResult.appUrl, deployResult.backendUrl);
      } else {
        console.log(`[stage6] No frontend/backend specific findings to route — exiting fix loop`);
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
