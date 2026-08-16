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
  ActivityFailure,
  ApplicationFailure,
} from "@temporalio/workflow";
import type * as activities from "../activities/index.ts";
import type { QAFixLoopActivityResult, DeployActivityResult } from "../activities/index.ts";

// 2026-08-11 (cost-control Task 1): pipeline/activities/index.ts's
// assertWithinBudget throws ApplicationFailure.create({ type:
// "BudgetExceeded", nonRetryable: true, ... }) when a project is over its
// per-project cap. Per @temporalio/common's ActivityFailure doc ("the
// ApplicationFailure from the last Activity Task will be the `cause` of the
// ActivityFailure thrown in the Workflow"), that surfaces here as an
// ActivityFailure whose .cause is the original ApplicationFailure with
// .type preserved — this is the real, documented shape (checked against
// node_modules/@temporalio/common's failure.d.ts, not guessed), not a
// message-string convention like isQuotaExhaustionError's. Used by the
// Stage 3 (generation) and Stage 5 (QA) catch blocks below to route a
// budget failure into escalateAndAwaitRetryDecision("budget_exceeded")
// instead of the generic "generation_failed" reason / an uncaught throw.
// 2026-08-13 (cost-control Task 1, test coverage gap closed): exported so
// this type-matching logic can be unit-tested in isolation, per the review
// that flagged it as "exactly the kind of SDK-internals-dependent code that
// silently breaks on a Temporal version bump with nothing to catch it" — see
// pipeline/workflows/budget-escalation.test.ts.
export function isBudgetExceededFailure(err: unknown): boolean {
  return (
    err instanceof ActivityFailure &&
    err.cause instanceof ApplicationFailure &&
    err.cause.type === "BudgetExceeded"
  );
}

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
// 2026-08-10: real gap found live (freshtst1) — every stuck-state/compile-
// repair-limit/deploy-failed escalation below used to call escalateTilotma
// (which only writes a "needs_review" status flag — see its own header
// comment, this IS the documented-but-unbuilt D16 "blocking HITL gate") and
// then `return`. For a Temporal workflow, `return` means the execution
// COMPLETES — permanently. There was no way to resume the SAME workflow run
// after root-causing and fixing the underlying issue; the only option was a
// throwaway script calling the stage function directly, bypassing the
// workflow (and losing its state/history) entirely. true = retry the stage
// that just got stuck; false = abandon (matches today's behavior exactly).
export const retryStageSignal = defineSignal<[boolean]>("retryStageSignal");

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
// 2026-08-17 (live, fulfillio1): a Stage-6-only failure (e.g. the
// context_chain_hash_mismatch class fixed above) kills the ENTIRE workflow
// execution non-retryably — Temporal signals can't reach a terminated
// execution, so the only way to make progress used to be starting a brand
// new workflow, which re-runs Saanvi/Arjun/generation/QA from scratch even
// though all of that work already succeeded and is sitting on disk/DB
// untouched. resumeFromDeploy lets a NEW workflow execution skip straight to
// Gate 2 + Stage 6 for a project whose spec/plan/generated-code/QA-pass
// already exist — every Stage 6 activity here already takes only projectId
// (runDeployWithLiveRetest, recordDeployHandoffActivity) and loads its own
// state from disk/cache, so no workflow-local `plan` value needs to be
// reconstructed for this to work.
export async function projectBuildWorkflow(projectId: string, userRequest?: string, resumeFromDeploy?: boolean): Promise<void> {
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

  // 2026-08-10: paired with retryStageSignal above — a stuck-state escalation
  // waits (bounded — D16's "blocking gate, timeout defined" pattern; a stuck
  // pipeline must not hold a Temporal workflow open forever with zero
  // resolution) for an explicit human retry-or-abandon decision instead of
  // unconditionally terminating. Reset to null before each wait so a stale
  // decision from a PRIOR escalation can never be misread as the answer to
  // THIS one — same convention as clarificationAnswer below.
  let retryDecision: boolean | null = null;
  setHandler(retryStageSignal, (retry) => {
    retryDecision = retry;
  });
  async function escalateAndAwaitRetryDecision(reason: string): Promise<boolean> {
    retryDecision = null;
    await act.escalateTilotma(projectId, reason, state);
    const decided = await condition(() => retryDecision !== null, "24 hours");
    if (!decided) {
      console.log(`[workflow] escalation "${reason}" got no human retry decision within 24h — treating as abandon`);
      return false;
    }
    return retryDecision === true;
  }

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

  // Gate 2 (deploy approval) + Stage 6 (deploy + live-browser retest),
  // extracted so both the normal post-QA flow and resumeFromDeploy (which
  // skips straight here) share one implementation instead of two copies
  // that could drift out of sync.
  async function runGate2AndStage6(): Promise<void> {
    // GATE 2: Deployment/Rollout Approval
    state.stage = "await_deploy_approval";
    await condition(() => deployApproved);

    // ── Stage 6: deploy + live-browser retest, retried in-place on an
    // explicit human decision ───────────────────────────────────────────
    state.stage = "deliver";
    for (;;) {
      // 2026-08-17 (live, fulfillio1 — 3rd occurrence of the same false-
      // positive class as two prior ones): recordHandoff used to be called
      // ONCE, before this loop, so a SECOND (or third) Stage 6 attempt's
      // verifyHandoff (inside runDeployWithLiveRetest) was checked against
      // the snapshot taken before the FIRST attempt ever ran. Riya's deploy
      // legitimately edits tracked source (e.g. docker-compose.yml, which
      // Navya/Karan/Deepika DO read as part of QA) while fixing deploy
      // config between attempts — a real, expected pipeline step, not
      // tampering — but any retry (deploy_failed, deploy_stuck,
      // budget_exceeded) tripped a non-retryable ContextChainViolation that
      // killed the ENTIRE workflow outright, discarding a genuinely
      // deployed, QA-passed, running app. Re-recording at the top of every
      // iteration keeps each attempt's tamper window scoped to that single
      // attempt (record here, verify moments later inside the activity)
      // instead of one stale snapshot spanning every retry.
      await orchestratorAct.recordDeployHandoffActivity(projectId);

      // 2026-08-13 (cost-control Task 1): runDeployWithLiveRetest now calls
      // assertWithinBudget before doing any deploy/live-retest work — this
      // call had no surrounding try/catch before, same uncaught-propagation
      // risk as the compile-repair sites above (see their comments for why
      // that would wedge the workflow instead of failing cleanly).
      let deployResult: DeployActivityResult;
      try {
        deployResult = await orchestratorAct.runDeployWithLiveRetest(projectId);
      } catch (err) {
        if (!isBudgetExceededFailure(err)) throw err;
        state.stage = "error";
        console.log(`[workflow] Stage 6 deploy halted — budget exceeded`);
        const retry = await escalateAndAwaitRetryDecision("budget_exceeded");
        if (!retry) {
          await act.markProjectFailed(projectId, "budget_exceeded");
          return;
        }
        state.stage = "deliver";
        console.log(`[workflow] retrying Stage 6 deploy after a human retry decision (budget_exceeded)`);
        continue;
      }
      if (deployResult.success) break;

      state.stage = "error";
      const retry = patched("stuck-state-retry-signal-v1")
        ? await escalateAndAwaitRetryDecision(deployResult.stuck ? "deploy_stuck" : "deploy_failed")
        : false;
      if (!retry) {
        await act.markProjectFailed(projectId, deployResult.stuck ? "deploy_stuck" : "deploy_failed");
        return;
      }
      state.stage = "deliver";
      console.log(`[workflow] retrying Stage 6 deploy after a human retry decision`);
    }

    state.stage = "done";
  }

  if (resumeFromDeploy) {
    console.log(`[workflow] resumeFromDeploy=true — skipping Stage 1-5, jumping straight to Gate 2 + Stage 6 for ${projectId}`);
    await runGate2AndStage6();
    return;
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

  // ── Stage 3: Parallel code generation, retried in-place on an explicit
  // human decision instead of unconditionally terminating the workflow ────
  // 2026-08-10: real bug found live (project rivhdw1) — a generator hitting
  // its own max-iterations cap (generatorFailure(), nonRetryable: true —
  // correct: Temporal retrying the identical prompt/budget would just hit
  // the same wall again) had NO surrounding handling at this level at all.
  // Promise.all's rejection propagated straight out of the workflow
  // function with no catch, killing the ENTIRE workflow execution — the
  // exact "unconditional termination, no resume path" bug already fixed
  // for the QA/compile/deploy escalations below, just never covered here.
  // A generator's own conversation history is persisted and reloaded on
  // each run() call (confirmed live: "[aanya:gemini-agent] Loaded existing
  // conversation history..."), so simply retrying picks up from where it
  // left off with a fresh iteration budget, not a blind restart.
  state.stage = "generate";
  for (;;) {
    const needs = await act.checkPlanNeeds(projectId);
    const genPromises: Promise<void>[] = [genAct.runAanya(projectId)];
    if (needs.shubham) {
      genPromises.push(genAct.runShubham(projectId));
    }
    if (needs.pranav) {
      genPromises.push(genAct.runPranav(projectId));
    }
    try {
      await Promise.all(genPromises);
      break;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.log(`[workflow] Stage 3 generation failed: ${reason}`);
      // 2026-08-11 (cost-control Task 1): a budget-exceeded generator
      // failure gets its own escalation reason so a human sees WHY the
      // pipeline stopped (over cap) instead of the generic
      // "generation_failed" a real code-generation bug would report.
      // Written as an explicit branch (not a computed variable) so both
      // literal calls stay grep/source-string visible — compile-loop.test.ts
      // asserts `escalateAndAwaitRetryDecision("generation_failed")` and
      // `markProjectFailed(projectId, "generation_failed")` verbatim.
      if (isBudgetExceededFailure(err)) {
        const retry = patched("generation-retry-signal-v1")
          ? await escalateAndAwaitRetryDecision("budget_exceeded")
          : false;
        if (!retry) {
          await act.markProjectFailed(projectId, "budget_exceeded");
          return;
        }
        console.log(`[workflow] retrying Stage 3 generation after a human retry decision (budget_exceeded)`);
        continue;
      }
      const retry = patched("generation-retry-signal-v1")
        ? await escalateAndAwaitRetryDecision("generation_failed")
        : false;
      if (!retry) {
        await act.markProjectFailed(projectId, "generation_failed");
        return;
      }
      console.log(`[workflow] retrying Stage 3 generation after a human retry decision`);
    }
  }

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
      // 2026-08-13 (cost-control Task 1): runCodeFix now calls
      // assertWithinBudget before doing any repair work — previously this
      // call had NO surrounding try/catch, so an over-budget failure here
      // would propagate as an uncaught ActivityFailure out of the workflow
      // function. That is NOT a clean workflow failure: per
      // @temporalio/common's own ActivityFailure doc, throwing anything
      // other than an ApplicationFailure from workflow code fails the
      // WORKFLOW TASK (retried indefinitely by the worker via replay), not
      // the workflow execution — so an uncaught budget trip here would have
      // wedged the workflow in a replay-and-fail loop forever instead of
      // halting cleanly. Caught the same way every other assertWithinBudget
      // call site already is.
      try {
        await genAct.runCodeFix(projectId, 0, `compile_error:\n${compile.errors}`);
      } catch (err) {
        if (!isBudgetExceededFailure(err)) throw err;
        state.stage = "error";
        console.log(`[workflow] pre-QA compile repair halted — budget exceeded`);
        const retry = await escalateAndAwaitRetryDecision("budget_exceeded");
        if (!retry) {
          await act.markProjectFailed(projectId, "budget_exceeded");
          return;
        }
        state.stage = "compile_check";
        console.log(`[workflow] retrying pre-QA compile repair after a human retry decision (budget_exceeded)`);
      }
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
    // ── Stage 5: the real GAN, retried in-place on an explicit human
    // decision instead of unconditionally terminating the workflow ────────
    state.stage = "qa";
    for (;;) {
      // 2026-08-11 (cost-control Task 1): runQAFixLoopActivity now calls
      // assertWithinBudget before doing any GAN work — previously this call
      // had NO surrounding try/catch at all, so any activity failure here
      // (budget-exceeded or otherwise) would propagate straight out of the
      // workflow function uncaught. This only intercepts the NEW
      // budget-exceeded failure (impossible in any pre-existing workflow
      // history — checkBudget didn't exist before this change, so no
      // in-flight replay can diverge) and routes it through the same
      // escalateAndAwaitRetryDecision pattern stuck-state already uses,
      // just with reason "budget_exceeded" instead of "stuck_state". Any
      // other failure is re-thrown unchanged, preserving today's exact
      // (uncaught-propagates) behavior for everything that isn't this new
      // failure type.
      let qaResult: QAFixLoopActivityResult;
      try {
        qaResult = await orchestratorAct.runQAFixLoopActivity(projectId);
      } catch (err) {
        if (!isBudgetExceededFailure(err)) throw err;
        console.log(`[workflow] Stage 5 QA halted — budget exceeded`);
        const retry = await escalateAndAwaitRetryDecision("budget_exceeded");
        if (!retry) {
          await act.markProjectFailed(projectId, "budget_exceeded");
          return;
        }
        console.log(`[workflow] retrying Stage 5 QA after a human retry decision (budget_exceeded)`);
        continue;
      }
      state.iteration = qaResult.iterations;
      if (qaResult.pass) break;

      // The GAN's own internal loop already exhausted its fix attempts or
      // hit its own stuck-detection (findings count stopped improving) —
      // don't re-litigate that here, just escalate with the evidence.
      // minScore/improvement are 0,0 placeholders: the real GAN tracks
      // convergence by findings COUNT, not a 0-100 score, so there's no
      // numeric score to log here — logStuckState's shape predates this
      // unification and is kept only for its audit-trail row.
      await act.logStuckState(projectId, qaResult.iterations, 0, 0);
      const retry = patched("stuck-state-retry-signal-v1")
        ? await escalateAndAwaitRetryDecision("stuck_state")
        : false;
      if (!retry) {
        await act.markProjectFailed(projectId, "stuck_state");
        return;
      }
      console.log(`[workflow] retrying Stage 5 QA after a human retry decision`);
    }

    // Deterministic safety net the GAN doesn't run itself: confirm the code
    // still compiles before handing off to deploy. Same bounded-retry shape
    // as the pre-QA gate above, also retried in-place on a human decision.
    state.stage = "compile_check";
    for (;;) {
      let postQaCompile = await act.runCompileCheck(projectId);
      let timeoutRetries = 0;
      while (!postQaCompile.pass && postQaCompile.timedOut && timeoutRetries < 3) {
        timeoutRetries++;
        console.log(`[workflow] post-QA compile check timed out (retry ${timeoutRetries}/3), rerunning directly`);
        postQaCompile = await act.runCompileCheck(projectId);
      }
      let postQaCompileFailures = 0;
      let exhausted = false;
      // 2026-08-13 (cost-control Task 1): see the pre-QA compile gate's
      // identical comment above for why an uncaught budget trip here would
      // wedge the workflow instead of failing cleanly. budgetExceeded is
      // handled AFTER this loop (not by escalating from inside it) so it
      // doesn't get tangled with postQaCompileFailures' own counting — a
      // budget halt is a different reason than "repair kept not fixing it".
      let budgetExceeded = false;
      while (!postQaCompile.pass) {
        postQaCompileFailures += 1;
        if (shouldStopCompileRepair(postQaCompileFailures, MAX_POST_QA_COMPILE_FAILURES)) {
          exhausted = true;
          break;
        }
        try {
          await genAct.runCodeFix(projectId, state.iteration, `compile_error:\n${postQaCompile.errors}`);
        } catch (err) {
          if (!isBudgetExceededFailure(err)) throw err;
          budgetExceeded = true;
          break;
        }
        postQaCompile = await act.runCompileCheck(projectId);
      }
      if (budgetExceeded) {
        state.stage = "error";
        console.log(`[workflow] post-QA compile repair halted — budget exceeded`);
        const retry = await escalateAndAwaitRetryDecision("budget_exceeded");
        if (!retry) {
          await act.markProjectFailed(projectId, "budget_exceeded");
          return;
        }
        state.stage = "compile_check";
        console.log(`[workflow] retrying post-QA compile repair after a human retry decision (budget_exceeded)`);
        continue;
      }
      if (!exhausted) break;

      state.stage = "error";
      const retry = patched("stuck-state-retry-signal-v1")
        ? await escalateAndAwaitRetryDecision("compile_repair_limit")
        : false;
      if (!retry) {
        await act.markProjectFailed(projectId, "compile_repair_limit");
        return;
      }
      state.stage = "compile_check";
      console.log(`[workflow] retrying post-QA compile repair after a human retry decision`);
    }

    // 2026-08-04 (live, final838491 — 2nd occurrence, root-caused): the
    // context-chain snapshot for Claim 3 (recordHandoff) used to be taken the
    // instant QA passed, BEFORE the compile-check retry loop above — which
    // can legitimately touch the build directory and caused two real,
    // reproducible false-positive hash mismatches. Snapshotting HERE, after
    // compile-check has settled and before the deploy-approval wait, closes
    // that race while still covering the actually-meaningful tamper window
    // (the human approval wait below, which can be long).
    //
    // GATE 2 + Stage 6 — see runGate2AndStage6 above (shared with
    // resumeFromDeploy so both paths stay in sync).
    await runGate2AndStage6();
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
