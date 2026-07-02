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
}

export interface Stage6Result {
  success: boolean;
  appUrl: string;
  findings?: unknown;
  deliverySummary: DeliverySummary;
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
  return {
    status: deployResult.success && retest.pass ? "delivered" : "failed",
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
  stage4Result: Stage4Result,
): Promise<LiveRetestResult> {
  const { runStage5 } = await import("./stage5-adversarial-qa.ts");

  const previousUrl = process.env.TIER3_REVIEW_URL;
  process.env.TIER3_REVIEW_URL = appUrl;
  try {
    const result: Stage5Result = await runStage5(projectId, stage4Result);
    return { pass: result.pass, findings: result.findings };
  } finally {
    if (previousUrl === undefined) {
      delete process.env.TIER3_REVIEW_URL;
    } else {
      process.env.TIER3_REVIEW_URL = previousUrl;
    }
  }
}

// Injectable seam for testing — runStage6() below wraps this with the real
// Riya.run + the real live-retest. Real docker deployment and a real live
// LLM-driven QA re-run are not unit-testable; the deterministic parts this
// stage owns (flag plumbing, fail-fast on deploy failure, delivery summary
// shape) are what stage6-deployment.test.ts covers via injected stubs — none
// of those tests rely on the default, they all pass their own `deps`.
export interface Stage6Deps {
  deployFn: (projectId: string, deployTarget: "local" | "gcp") => Promise<DeployResult>;
  liveRetestFn: (projectId: string, appUrl: string) => Promise<LiveRetestResult>;
}

export async function runStage6(
  projectId: string,
  stage4Result: Stage4Result,
  // Default constructed per-call (not a module-level constant) so
  // liveRetestFn can close over this call's own `stage4Result` — the real
  // live retest needs it to know which output directories to re-scan.
  deps: Stage6Deps = {
    deployFn: runRiya,
    liveRetestFn: (pid, appUrl) => runRealLiveRetest(pid, appUrl, stage4Result),
  },
): Promise<Stage6Result> {
  const flags = resolveFlags();

  const deployResult = await deps.deployFn(projectId, flags.deployTarget);

  if (!deployResult.success) {
    // Fail fast — do not spend time re-running QA against a deploy that
    // didn't come up healthy in the first place.
    return {
      success: false,
      appUrl: deployResult.appUrl,
      findings: { deployErrors: deployResult.errors },
      deliverySummary: buildDeliverySummary(deployResult, { pass: false, findings: null }),
    };
  }

  const retest = await deps.liveRetestFn(projectId, deployResult.appUrl);

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
