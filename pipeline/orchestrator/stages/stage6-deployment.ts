// Stage 6 — Deployment: wraps Riya with the deployTarget flag, then re-runs
// Stage 5's adversarial QA against the LIVE deployed URL. This is the "live
// retest" the design doc calls out explicitly — it is what would have caught
// Sprint 1's CORS-origin-mismatch and unmounted-routes bugs immediately,
// since those were deploy-config issues invisible before containers were
// actually running (see design doc, Stage 6 section).
//
// ── Stage 5 live-retest status (read before touching this file) ────────────
// As of this task (Task 13), Task 12 (pipeline/orchestrator/stages/stage5-
// adversarial-qa.ts) has NOT landed yet — only stage4-multi-agent-dev.ts
// exists in pipeline/orchestrator/stages/ as of this writing. Importing a
// `runStage5` here would fail to resolve, so the live-retest call below is a
// clearly-marked stub (`runLiveRetestStub`) rather than a blocker on Task 12
// landing, per this task's brief. When stage5-adversarial-qa.ts exists and
// exports a function that can run QA against a live URL, replace
// `defaultDeps.liveRetestFn` with a real dynamic import — the same
// `await import(...)` pattern stage4-multi-agent-dev.ts uses for its agent
// calls — and delete `runLiveRetestStub`.
import { resolveFlags } from "../flags.ts";
import { run as runRiya, type DeployResult } from "../../../agents/riya/src/index.ts";
import type { Stage4Result } from "./stage4-multi-agent-dev.ts";

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

// STUB — see the file-header comment. Preserves the "re-run Stage 5 QA
// against the live URL" contract without blocking Stage 6 on Task 12's
// landing. Always reports a pass with no findings so deployment isn't
// artificially blocked by a stub — this MUST be replaced with the real Stage
// 5 live retest before this pipeline is considered production-ready; do not
// remove this warning without wiring the real call.
async function runLiveRetestStub(projectId: string, appUrl: string): Promise<LiveRetestResult> {
  console.warn(
    `[stage6] Stage 5 live-retest STUBBED for project ${projectId} against ${appUrl} — ` +
      `stage5-adversarial-qa.ts (Task 12) is not available yet. Treating as pass with no ` +
      `findings so deployment is not blocked on it, but this is NOT real QA coverage.`,
  );
  return { pass: true, findings: [] };
}

// Injectable seam for testing — runStage6() below wraps this with the real
// Riya.run + the live-retest stub. Real docker deployment and a real live
// LLM-driven QA re-run are not unit-testable; the deterministic parts this
// stage owns (flag plumbing, fail-fast on deploy failure, delivery summary
// shape) are what stage6-deployment.test.ts covers via these injected stubs.
export interface Stage6Deps {
  deployFn: (projectId: string, deployTarget: "local" | "gcp") => Promise<DeployResult>;
  liveRetestFn: (projectId: string, appUrl: string) => Promise<LiveRetestResult>;
}

const defaultDeps: Stage6Deps = {
  deployFn: runRiya,
  liveRetestFn: runLiveRetestStub,
};

export async function runStage6(
  projectId: string,
  stage4Result: Stage4Result,
  deps: Stage6Deps = defaultDeps,
): Promise<Stage6Result> {
  // stage4Result isn't consumed directly here — Riya reads the already-
  // written backend/frontend output directories straight off BUILD_DIR for
  // this projectId (same convention every other stage uses). It's accepted
  // as a parameter per this task's required signature so the stage's input
  // type makes the Stage 4 -> Stage 6 dependency explicit in the pipeline's
  // types, matching how stage5's runStage5(projectId, stage4Result) does it.
  void stage4Result;

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
