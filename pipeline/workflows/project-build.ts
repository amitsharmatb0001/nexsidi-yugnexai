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

// 2026-07-25 (Phase 2.1): deployAct (a "no heartbeatTimeout because
// execSync blocks the event loop" proxy sized for runRiya's direct
// docker+GitHub archive path) was removed here — its only caller was the
// deleted legacy loop's tail delivery step. The live unified path deploys
// via orchestratorAct.runDeployWithLiveRetest below instead.

// 2026-07-24 (P1): the real GAN (runQAFixLoopActivity) can run up to
// MAX_FIX_ITERATIONS=5 full rounds, each round a complete QA pass (up to
// 30 tool-call iterations per agent) PLUS a generator fix pass (up to 40
// iterations) — well beyond genAct's 30-minute budget, which was sized for
// a single generation pass. runDeployWithLiveRetest similarly re-runs a
// full QA pass plus the Tier-3 browser review against the live deploy, up
// to MAX_DEPLOY_ATTEMPTS=2 times. Both activities heartbeat internally
// every 30s (see pipeline/activities/index.ts), so a generous
// startToCloseTimeout with a heartbeatTimeout is safe — Temporal will still
// notice a genuinely hung activity within one missed heartbeat window.
const orchestratorAct = proxyActivities<typeof activities>({
  startToCloseTimeout: "2 hours",
  heartbeatTimeout: "3 minutes",
  retry: { maximumAttempts: 2 },
});

export const approveSpecSignal = defineSignal<[boolean]>("approveSpecSignal");
export const approveDeploySignal = defineSignal<[boolean]>("approveDeploySignal");
// 2026-08-05: generic pause-and-ask primitive (see askAndWait below) — one
// signal answers whatever question is currently pending, whichever agent/
// stage raised it. Reused by Saanvi's clarification loop; available to any
// future stuck-agent escalation without new signal plumbing.
export const answerClarificationSignal = defineSignal<[string]>("answerClarificationSignal");

// ─── Pipeline State ────────────────────────────────────────────────────────
export interface PipelineState {
  projectId:         string;
  stage:             string;
  iteration:         number;
  // Fix #7: store last 3 minimum QA scores to detect stuck-state
  recentMinScores:   number[];
  stuckIterations:   number;
  lastGoodStateHash: string | null;
  // 2026-08-05: non-null while the workflow is paused waiting on
  // answerClarificationSignal — the question(s) currently pending, visible
  // via getPipelineState so a caller knows WHAT to answer, not just that
  // the pipeline is stuck.
  pendingQuestions:  string[] | null;
  // 2026-08-05: real gap found live — Vanya's design brief (palette,
  // typography, layout concept, mood) was generated and used silently; no
  // page or query ever surfaced it, so "approve the spec" never meant
  // "approve the design" even though CLAUDE.md's own approval flow implies
  // both. Populated right before await_spec_approval so a caller has
  // something concrete to review, not just a feature list.
  designBrief: DesignBriefSummary | null;
}

// Query-facing shape only — avoids this workflow file importing Vanya's
// full DesignBrief type just to re-export its shape; keeps the workflow's
// only dependency on agent internals to the activity boundary (act.*), same
// as everywhere else in this file.
export interface DesignBriefSummary {
  mood: string;
  palette: Array<{ name: string; hex: string }>;
  typography: { display: string; body: string };
  layoutConcept: string;
}

export const getPipelineState = defineQuery<PipelineState>("getPipelineState");

const MAX_POST_QA_COMPILE_FAILURES = 3;
// 2026-08-05: bounds Saanvi's clarification loop — each round should narrow
// the ambiguity (the user's answer is appended, not discarded), so a request
// that still can't be spec'd after this many rounds is a genuine escalation,
// not "ask one more question".
const MAX_CLARIFICATION_ROUNDS = 3;

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
    pendingQuestions: null,
    designBrief: null,
  };
  setHandler(getPipelineState, () => ({ ...state }));

  // 2026-08-05: was a plain boolean defaulting to false — indistinguishable
  // from "not yet answered", so signaling approveSpecSignal(false) (an
  // explicit REJECTION) did nothing: condition(() => specApproved) just kept
  // waiting forever, identical to never having signaled at all. There was no
  // real reject-and-redo path, only "approve" and "silently hang". A tri-
  // state decision lets the workflow tell the two apart and act on a
  // rejection (see the spec/design loop below).
  let specDecision: "approved" | "rejected" | null = null;
  setHandler(approveSpecSignal, (approved) => {
    specDecision = approved ? "approved" : "rejected";
  });

  let deployApproved = false;
  setHandler(approveDeploySignal, (approved) => {
    deployApproved = approved;
  });

  // 2026-08-05: generic pause-and-ask primitive. Sets pendingQuestions
  // (visible via getPipelineState), blocks until answerClarificationSignal
  // fires, then clears it and returns the answer. `clarificationAnswer`
  // starts null each call so a stale answer from a PRIOR question can never
  // be misread as the answer to THIS one.
  let clarificationAnswer: string | null = null;
  setHandler(answerClarificationSignal, (answer) => {
    clarificationAnswer = answer;
  });
  async function askAndWait(questions: string[]): Promise<string> {
    clarificationAnswer = null;
    state.pendingQuestions = questions;
    await condition(() => clarificationAnswer !== null);
    state.pendingQuestions = null;
    return clarificationAnswer as string;
  }

  // ── Stage 1+2: Spec, design, and decomposition, looped until approved ───
  // 2026-08-05: two things folded into one loop, both root-caused live:
  //   1. Saanvi's own "too ambiguous to spec confidently" signal — see
  //      agents/saanvi/src/index.ts's SaanviResult header comment.
  //   2. A rejection at the approval gate used to be a dead end
  //      (approveSpecSignal(false) just made the wait condition permanently
  //      false — nothing ever asked what to change, the workflow just hung).
  //      Now a rejection asks ONE question ("what would you like changed"),
  //      re-runs Saanvi+Arjun with that feedback appended, and re-presents —
  //      including the design brief, which is now part of what's approved
  //      (see designBrief on PipelineState — previously invisible entirely).
  // clarificationHistory ACCUMULATES every round's question+answer (ambiguity
  // AND rejection feedback alike, sharing one cap) — passing only the latest
  // answer would silently drop earlier rounds' context, since runSaanvi
  // always re-reads the ORIGINAL cached request fresh and appends whatever
  // context string it's given.
  let clarificationRounds = 0;
  const clarificationHistory: string[] = [];
  for (;;) {
    state.stage = "spec";
    for (;;) {
      const saanviResult = await act.runSaanvi(
        projectId,
        clarificationRounds === 0 ? userRequest : undefined,
        clarificationHistory.length > 0 ? clarificationHistory.join("\n\n") : undefined,
      );
      if (saanviResult.status === "locked") break;

      clarificationRounds++;
      if (clarificationRounds > MAX_CLARIFICATION_ROUNDS || !saanviResult.questions) {
        state.stage = "error";
        await act.markProjectFailed(projectId, "clarification_exhausted");
        await act.escalateTilotma(projectId, "clarification_exhausted", state);
        return;
      }

      state.stage = "awaiting_clarification";
      const answer = await askAndWait(saanviResult.questions);
      state.stage = "spec";
      clarificationHistory.push(`Q: ${saanviResult.questions.join(" / ")}\nA: ${answer}`);
    }

    // ── Stage 2: Task decomposition (includes Vanya's design brief) ───────
    state.stage = "decompose";
    await act.runArjun(projectId);
    state.designBrief = await act.getDesignBrief(projectId);

    // GATE 1: Spec/Plan/Design Approval — always required. A stale
    // build-plan.json from a prior run must not bypass this; the user must
    // confirm each new run's spec AND design (state.designBrief, above).
    state.stage = "await_spec_approval";
    specDecision = null;
    await condition(() => specDecision !== null);
    if (specDecision === "approved") break;

    clarificationRounds++;
    if (clarificationRounds > MAX_CLARIFICATION_ROUNDS) {
      state.stage = "error";
      await act.markProjectFailed(projectId, "spec_rejected_too_many_times");
      await act.escalateTilotma(projectId, "spec_rejected_too_many_times", state);
      return;
    }
    state.stage = "awaiting_clarification";
    const feedback = await askAndWait(["The spec/design was rejected — what would you like changed?"]);
    clarificationHistory.push(`Q: What would you like changed about the spec/design?\nA: ${feedback}`);
  }

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

  // ── P1 (full agentic upgrade, 2026-07-24): unify onto the real GAN ───────
  // Replaces the degenerate one-shot QA scorer (a flash model guessing a
  // score from a 20K-char code sample, no file locations, oscillating
  // 69-93 across iterations) with the real evidence-gated GAN — agents
  // that read files themselves, peer debate to drop false positives, and
  // fault-isolated fixes — already built (pipeline/orchestrator/stages/
  // stage5-qa-fix-loop.ts) but previously reachable only from dev-run.ts,
  // never this Temporal worker. Deploy is likewise replaced with Stage 6:
  // deploy THEN re-run adversarial QA against the live URL with a real
  // Playwright browser (Tilotma Tier-3) — the only point in the running
  // pipeline that actually observes the frontend rendering, not curling
  // an HTTP status code. patched() so any workflow already in flight when
  // this deploys keeps replaying its original (pre-unification) code path.
  if (patched("unify-real-gan-and-deploy-v1")) {
    state.stage = "qa";
    const qaResult = await orchestratorAct.runQAFixLoopActivity(projectId);
    state.iteration = qaResult.iterations;

    if (!qaResult.pass) {
      // The GAN's own internal loop already exhausted its fix attempts or
      // hit its own stuck-detection (findings count stopped improving) —
      // don't re-litigate that here, just escalate with the evidence.
      // minScore/improvement are 0,0 placeholders: the real GAN tracks
      // convergence by findings COUNT, not a 0-100 score, so there's no
      // numeric score to log here — logStuckState's shape predates this
      // unification and is kept only for its audit-trail row.
      await act.logStuckState(projectId, qaResult.iterations, 0, 0);
      await act.escalateTilotma(projectId, "stuck_state", state);
      return;
    }

    // Deterministic safety net the GAN doesn't run itself: confirm the code
    // still compiles before handing off to deploy. Same bounded-retry shape
    // as the pre-QA gate above.
    state.stage = "compile_check";
    let postQaCompile = await act.runCompileCheck(projectId);
    let timeoutRetries = 0;
    while (!postQaCompile.pass && postQaCompile.timedOut && timeoutRetries < 3) {
      timeoutRetries++;
      console.log(`[workflow] post-QA compile check timed out (retry ${timeoutRetries}/3), rerunning directly`);
      postQaCompile = await act.runCompileCheck(projectId);
    }
    let postQaCompileFailures = 0;
    while (!postQaCompile.pass) {
      postQaCompileFailures += 1;
      if (shouldStopCompileRepair(postQaCompileFailures, MAX_POST_QA_COMPILE_FAILURES)) {
        state.stage = "error";
        await act.markProjectFailed(projectId, "compile_repair_limit");
        await act.escalateTilotma(projectId, "compile_repair_limit", state);
        return;
      }
      await genAct.runCodeFix(projectId, state.iteration, `compile_error:\n${postQaCompile.errors}`);
      postQaCompile = await act.runCompileCheck(projectId);
    }

    // 2026-08-04 (live, final838491 — 2nd occurrence, root-caused): the
    // context-chain snapshot for Claim 3 (recordHandoff) used to be taken the
    // instant QA passed, BEFORE the compile-check retry loop above — which
    // can legitimately touch the build directory and caused two real,
    // reproducible false-positive hash mismatches. Snapshotting HERE, after
    // compile-check has settled and before the deploy-approval wait, closes
    // that race while still covering the actually-meaningful tamper window
    // (the human approval wait below, which can be long).
    await orchestratorAct.recordDeployHandoffActivity(projectId);

    // GATE 2: Deployment/Rollout Approval
    state.stage = "await_deploy_approval";
    await condition(() => deployApproved);

    // ── Stage 6: deploy + live-browser retest ──────────────────────────────
    state.stage = "deliver";
    const deployResult = await orchestratorAct.runDeployWithLiveRetest(projectId);
    if (!deployResult.success) {
      state.stage = "error";
      await act.markProjectFailed(projectId, deployResult.stuck ? "deploy_stuck" : "deploy_failed");
      await act.escalateTilotma(projectId, "deploy_failed", state);
      return;
    }

    state.stage = "done";
    return;
  }

  // 2026-07-25 (Phase 2.1, full MVP upgrade): the pre-unification legacy QA
  // loop that used to live here (per-agent Navya/Karan/Deepika severity
  // scoring, no located findings, no live-browser observation) is deleted,
  // not just dead-code-flagged. It is provably unreachable: patched()
  // returns true unconditionally for every workflow execution started after
  // this patch marker was introduced (2026-07-24) — the branch above always
  // returns. It would only matter for replaying a workflow history that was
  // ALREADY IN FLIGHT at that exact patch boundary; per audit-2026-07-25.md
  // (A.3), every prior run (nextech1-9) has since completed or failed, and
  // Phase 7 restarts the worker fresh, so no such in-flight history exists
  // to replay. Deleting it also retires its five now-truly-dead-only
  // activities (runSpecCompliance, runNavya, runKaran, runDeepika,
  // runLiveCheck, runTier3Gate, runRiya — see activities/index.ts) — none
  // of the other unified-path stages (Stage 5's real GAN, Stage 6's live
  // retest) ever called them; only this deleted loop did.
  throw new Error(
    "[workflow] unreachable: patched('unify-real-gan-and-deploy-v1') must be true for every workflow started after 2026-07-24 — reaching this line means an in-flight workflow from before that patch is replaying and hit code that no longer exists. Do not resume it; start a fresh run instead.",
  );
}
