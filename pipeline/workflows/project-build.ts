// Main NexSidi build pipeline — Temporal workflow
//
// Fix #7: stuck-state counter lives IN workflow state (not in-memory),
//         so it survives Temporal worker restarts and is visible in the UI.
// Fix #8: any single QA agent scoring <85 blocks — NOT the average.

import {
  proxyActivities,
  defineQuery,
  defineSignal,
  setHandler,
  sleep,
  patched,
  condition,
} from "@temporalio/workflow";
import type * as activities from "../activities/index.ts";

// Short timeout for single-LLM-call activities (spec, QA, compliance)
const act = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  heartbeatTimeout: "2 minutes",   // reschedule if worker dies within 2 min
  retry: { maximumAttempts: 3 },
});

// Long timeout for code generation — multiple sequential NIM calls per task list
const genAct = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 minutes",
  heartbeatTimeout: "3 minutes",   // NIM calls take up to 90s + 30s heartbeat gap
  retry: { maximumAttempts: 5 },   // more headroom while we tune the output format
});

// Deploy proxy — no heartbeatTimeout because execSync blocks the event loop
// startToCloseTimeout must cover: docker build (5 min) + startup (1 min) + GitHub (1 min)
const deployAct = proxyActivities<typeof activities>({
  startToCloseTimeout: "15 minutes",
  retry: { maximumAttempts: 2 },
});

export const approveSpecSignal = defineSignal<[boolean]>("approveSpecSignal");
export const approveDeploySignal = defineSignal<[boolean]>("approveDeploySignal");

// ─── Pipeline State ────────────────────────────────────────────────────────
export interface PipelineState {
  projectId:         string;
  stage:             string;
  iteration:         number;
  // Fix #7: store last 3 minimum QA scores to detect stuck-state
  recentMinScores:   number[];
  stuckIterations:   number;
  lastGoodStateHash: string | null;
}

export const getPipelineState = defineQuery<PipelineState>("getPipelineState");

const MAX_POST_QA_COMPILE_FAILURES = 3;

export function shouldStopCompileRepair(failures: number, maximum: number): boolean {
  return failures >= maximum;
}

// ─── Workflow ──────────────────────────────────────────────────────────────
// userRequest is passed from Maya → Temporal, then forwarded to the Saanvi activity.
// The activity writes it to BUILD_DIR/{projectId}/user-request.txt for all downstream agents.
export async function projectBuildWorkflow(projectId: string, userRequest?: string): Promise<void> {
  const state: PipelineState = {
    projectId,
    stage: "spec",
    iteration: 0,
    recentMinScores: [],
    stuckIterations: 0,
    lastGoodStateHash: null,
  };
  setHandler(getPipelineState, () => ({ ...state }));

  let specApproved = false;
  setHandler(approveSpecSignal, (approved) => {
    specApproved = approved;
  });

  let deployApproved = false;
  setHandler(approveDeploySignal, (approved) => {
    deployApproved = approved;
  });

  // ── Stage 1: Spec ───────────────────────────────────────────────────────
  state.stage = "spec";
  await act.runSaanvi(projectId, userRequest);

  // ── Stage 2: Task decomposition ─────────────────────────────────────────
  state.stage = "decompose";
  await act.runArjun(projectId);

  // GATE 1: Spec/Plan Approval — always required. A stale build-plan.json from a
  // prior run must not bypass this; the user must confirm each new run's spec.
  state.stage = "await_spec_approval";
  await condition(() => specApproved);

  // ── Stage 3: Parallel code generation ───────────────────────────────────
  state.stage = "generate";
  const needs = await act.checkPlanNeeds(projectId);
  const genPromises: Promise<void>[] = [genAct.runAanya(projectId)];
  if (needs.shubham) {
    genPromises.push(genAct.runShubham(projectId));
  }
  if (needs.pranav) {
    genPromises.push(genAct.runPranav(projectId));
  }
  await Promise.all(genPromises);

  // ── Stage 3b: TypeScript compile gate (before QA — fail fast) ────────────
  state.stage = "compile_check";
  let compileAttempts = 0;
  while (compileAttempts < 3) {
    const compile = await act.runCompileCheck(projectId);
    if (compile.pass) break;
    compileAttempts++;
    console.log(`[workflow] compile check failed (attempt ${compileAttempts}/3): ${compile.errors.slice(0, 200)}`);
    // A timed-out tsc run reported no real error — just rerun the check, don't
    // waste a code-fix cycle chasing a bug that was never actually observed.
    if (compile.timedOut) continue;
    if (compileAttempts < 3) {
      await genAct.runCodeFix(projectId, 0, `compile_error:\n${compile.errors}`);
    }
  }
  // After 3 failed compile attempts, continue anyway — QA will catch it.

  // ── QA Loop ─────────────────────────────────────────────────────────────
  state.stage = "qa";
  let specMismatchCount = 0;
  let postQaCompileFailures = 0;
  while (true) {
    state.iteration += 1;

    // Stage 0 (cheap gate): spec-compliance check (D21)
    const compliant = await act.runSpecCompliance(projectId, state.iteration);
    if (!compliant) {
      specMismatchCount++;
      if (specMismatchCount < 3) {
        await genAct.runCodeFix(projectId, state.iteration, "spec_mismatch");
        continue;
      }
      // After 3 spec failures, force through to QA — don't loop forever
    } else {
      specMismatchCount = 0;
    }

    // Stage 1 (static): Navya + Karan + Deepika in parallel
    // Fix #8: returns individual scores, NOT averaged
    const [navyaScore, karanScore, deepikaScore] = await Promise.all([
      act.runNavya(projectId, state.iteration),
      act.runKaran(projectId, state.iteration),
      act.runDeepika(projectId, state.iteration),
    ]);

    const minScore = Math.min(navyaScore, karanScore, deepikaScore);

    // Production threshold: ≥85 per spec. Scoring: CRITICAL×20, HIGH×10, MEDIUM×5, LOW×1.
    const allPass = navyaScore >= 85 && karanScore >= 85 && deepikaScore >= 85;

    if (!allPass) {
      // Stuck-state detection (D19 / Fix #7)
      state.recentMinScores.push(minScore);
      if (state.recentMinScores.length > 3) state.recentMinScores.shift();

      if (state.recentMinScores.length === 3) {
        const improvement =
          (state.recentMinScores[2] ?? 0) - (state.recentMinScores[0] ?? 0);
        if (improvement < 3) {
          state.stuckIterations += 1;
          await act.logStuckState(projectId, state.iteration, minScore, improvement);
          if (state.stuckIterations >= 1) {
            // Escalate — Tilotma asks user ONE specific question
            await act.escalateTilotma(projectId, "stuck_state", state);
            return;
          }
        } else {
          state.stuckIterations = 0;
        }
      }

      await genAct.runCodeFix(projectId, state.iteration, "qa_fail");
      continue;
    }

    // Stage 1.5: compile check after QA pass — catches syntax errors before Docker
    // Runs npm install so tsc can resolve all imports properly.
    let postQaCompile = await act.runCompileCheck(projectId);
    // A timed-out tsc run under system load reports no real error — retry the
    // check directly (not a full QA re-run, not a code-fix cycle) rather than
    // spending the repair budget on a bug that was never actually observed.
    let timeoutRetries = 0;
    while (!postQaCompile.pass && postQaCompile.timedOut && timeoutRetries < 3) {
      timeoutRetries++;
      console.log(`[workflow] post-QA compile check timed out (retry ${timeoutRetries}/3), rerunning directly`);
      postQaCompile = await act.runCompileCheck(projectId);
    }
    if (!postQaCompile.pass) {
      postQaCompileFailures += 1;
      if (
        patched("post-qa-compile-repair-limit-v1") &&
        shouldStopCompileRepair(postQaCompileFailures, MAX_POST_QA_COMPILE_FAILURES)
      ) {
        state.stage = "error";
        if (patched("persist-project-failure-v1")) {
          await act.markProjectFailed(projectId, "compile_repair_limit");
        }
        await act.escalateTilotma(projectId, "compile_repair_limit", state);
        return;
      }
      await genAct.runCodeFix(projectId, state.iteration, `compile_error:\n${postQaCompile.errors}`);
      continue;
    }

    // Stage 2 (live execution): Docker build + start + curl endpoint (D20)
    state.stage = "live_test";
    const live = await act.runLiveCheck(projectId);
    if (live.pass) {
      // Stage 1.5b: Tier-3 browser observation gate (two-stage Evidence + Reality Check)
      // Uses genAct (30-min timeout) — two full agent loops with browser screenshot tools
      state.stage = "tier3_review";
      const tier3 = await genAct.runTier3Gate(projectId);
      if (tier3.skipped || tier3.pass) {
        break; // all gates passed — exit QA loop
      }
      // Tier-3 found issues — code fix then re-enter the QA loop
      await genAct.runCodeFix(projectId, state.iteration, `tier3_fail: ${tier3.findings.slice(0, 3).join("; ")}`);
      state.stage = "qa";
      continue;
    }

    state.stage = "qa";
    await genAct.runCodeFix(projectId, state.iteration, `live_check_fail: ${live.detail}`);
  }

  // GATE 2: Deployment/Rollout Approval
  state.stage = "await_deploy_approval";
  await condition(() => deployApproved);

  // ── Stage 4: Delivery ───────────────────────────────────────────────────
  state.stage = "deliver";
  // Fix #9: Riya archives to GitHub before delivering to user
  // Uses deployAct (no heartbeatTimeout) because docker build blocks the event loop
  await deployAct.runRiya(projectId);

  state.stage = "done";
}
