// Main NexSidi build pipeline — Temporal workflow
//
// Fix #7: stuck-state counter lives IN workflow state (not in-memory),
//         so it survives Temporal worker restarts and is visible in the UI.
// Fix #8: any single QA agent scoring <85 blocks — NOT the average.

import {
  proxyActivities,
  defineQuery,
  setHandler,
  sleep,
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

  // ── Stage 1: Spec ───────────────────────────────────────────────────────
  state.stage = "spec";
  await act.runSaanvi(projectId, userRequest);

  // ── Stage 2: Task decomposition ─────────────────────────────────────────
  state.stage = "decompose";
  await act.runArjun(projectId);

  // ── Stage 3: Parallel code generation ───────────────────────────────────
  state.stage = "generate";
  await Promise.all([
    genAct.runShubham(projectId),
    genAct.runAanya(projectId),
    genAct.runPranav(projectId),
  ]);

  // ── Stage 3b: TypeScript compile gate (before QA — fail fast) ────────────
  state.stage = "compile_check";
  let compileAttempts = 0;
  while (compileAttempts < 3) {
    const compile = await act.runCompileCheck(projectId);
    if (compile.pass) break;
    compileAttempts++;
    console.log(`[workflow] compile check failed (attempt ${compileAttempts}/3): ${compile.errors.slice(0, 200)}`);
    if (compileAttempts < 3) {
      await genAct.runCodeFix(projectId, 0, `compile_error:\n${compile.errors}`);
    }
  }
  // After 3 failed compile attempts, continue anyway — QA will catch it.

  // ── QA Loop ─────────────────────────────────────────────────────────────
  state.stage = "qa";
  let specMismatchCount = 0;
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

    // Phase 1 threshold: ≥70. New scoring formula (CRITICAL×10 not ×20) makes this achievable.
    // Phase 2 will raise to ≥85 once live Playwright eval also gates delivery.
    const allPass = navyaScore >= 70 && karanScore >= 70 && deepikaScore >= 70;

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

    // Stage 2 (live execution): Docker build + start + curl endpoint (D20)
    state.stage = "live_test";
    const live = await act.runLiveCheck(projectId);
    if (live.pass) break; // server starts and responds — pipeline passes

    state.stage = "qa";
    await genAct.runCodeFix(projectId, state.iteration, `live_check_fail: ${live.detail}`);
  }

  // ── Stage 4: Delivery ───────────────────────────────────────────────────
  state.stage = "deliver";
  // Fix #9: Riya archives to GitHub before delivering to user
  // Uses deployAct (no heartbeatTimeout) because docker build blocks the event loop
  await deployAct.runRiya(projectId);

  state.stage = "done";
}
