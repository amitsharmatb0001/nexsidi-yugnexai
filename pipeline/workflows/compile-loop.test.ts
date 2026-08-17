import { expect, test } from "bun:test";
import { readFileSync } from "fs";

test("stops post-QA compile repair after the configured maximum", async () => {
  const workflow = await import("./project-build.ts") as Record<string, unknown>;
  const shouldStopCompileRepair = workflow.shouldStopCompileRepair as
    | ((failures: number, maximum: number) => boolean)
    | undefined;

  expect(typeof shouldStopCompileRepair).toBe("function");
  expect(shouldStopCompileRepair?.(2, 3)).toBe(false);
  expect(shouldStopCompileRepair?.(3, 3)).toBe(true);
  expect(shouldStopCompileRepair?.(4, 3)).toBe(true);
});

// 2026-07-25 (Phase 2.1, full MVP upgrade): the two tests below used to
// assert on patched("post-qa-compile-repair-limit-v1") and
// patched("persist-project-failure-v1") — nested replay-safety markers that
// lived ONLY inside the legacy pre-unification QA loop, guarding its OWN
// gradual rollout. That loop has since been deleted as provably
// unreachable: patched("unify-real-gan-and-deploy-v1") (the OUTER gate,
// still asserted below) is unconditionally true for every workflow started
// after 2026-07-24, and the branch it guards always returns before the
// deleted code could ever run — see project-build.ts's own comment at the
// deletion site and .nexsidi/sdd/audit-2026-07-25.md. The nested patches
// were themselves legacy scaffolding for a rollout the outer patch already
// completed; once the branch they lived in is unreachable, keeping their
// string in source serves no replay-safety purpose (no workflow history
// can be paused at a point that would need them). These tests now assert
// the CURRENT replay-safety story: the still-load-bearing outer patch, and
// that failure is still persisted unconditionally on the live path (no
// longer behind its own extra patch marker, since the outer gate already
// makes this the only path new workflows take).
test("versions the unified GAN/deploy workflow change for Temporal replay safety", () => {
  const source = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");

  expect(source).toContain('patched("unify-real-gan-and-deploy-v1")');
});

test("persists project failure before returning from the capped compile loop", () => {
  const source = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");

  expect(source).toContain('await act.markProjectFailed(projectId, "compile_repair_limit")');
});

// 2026-08-10: real gap found live (freshtst1) — every escalation used to
// `return` unconditionally, which COMPLETES (permanently terminates) a
// Temporal workflow execution with no way to resume the same run. Verifies
// the fix's shape directly from source (same lightweight convention as the
// two tests above, given a full TestWorkflowEnvironment run of this
// workflow isn't set up in this repo yet): a retryStageSignal is exported,
// every one of the three escalation sites awaits a real retry decision
// before ever calling markProjectFailed, and abandoning still fails the
// project exactly as before (so declining to retry isn't a behavior
// regression, just no longer the ONLY option).
test("exports a retryStageSignal a human can use to resume a stuck workflow instead of it terminating for good", () => {
  const source = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");

  expect(source).toContain('export const retryStageSignal = defineSignal<[boolean]>("retryStageSignal")');
});

test("every escalation site awaits a retry decision before persisting failure, for all three stuck-state reasons", () => {
  const source = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");

  for (const reason of ["stuck_state", "compile_repair_limit"]) {
    const escalateCall = `escalateAndAwaitRetryDecision("${reason}")`;
    const failCall = `await act.markProjectFailed(projectId, "${reason}")`;
    expect(source).toContain(escalateCall);
    expect(source).toContain(failCall);
    // the retry decision must be awaited BEFORE the project is marked
    // failed — otherwise a human choosing "retry" would arrive too late,
    // after the workflow already gave up.
    expect(source.indexOf(escalateCall)).toBeLessThan(source.indexOf(failCall));
  }
  // deploy_failed/deploy_stuck share one escalation call. 2026-08-17: the
  // reason used to be computed inline at both the escalate and fail call
  // sites (deployResult.stuck ? "deploy_stuck" : "deploy_failed", written
  // out twice) — now computed once into `escalationReason` so the
  // auto-retry-when-not-stuck check below and both call sites can't drift
  // out of sync with each other.
  expect(source).toContain('const escalationReason = deployResult.stuck ? "deploy_stuck" : "deploy_failed"');
  expect(source).toContain("escalateAndAwaitRetryDecision(escalationReason)");
  expect(source).toContain("await act.markProjectFailed(projectId, escalationReason)");
});

// 2026-08-17 (live, fulfillio1): every Stage 6 failure used to escalate to a
// human EVERY time, even when deployResult.stuck === false — even though
// that flag means runDeployWithLiveRetest's OWN internal retry loop already
// confirmed the error signature CHANGED between its attempts (real
// progress, not a loop). Verifies the auto-retry path exists, is bounded
// (can't drift forever without ever checking in with a human), and only
// engages when stuck is specifically false — a confirmed loop (stuck=true)
// must still escalate immediately, not spend 3 auto-retries on a case
// that's already known to be futile.
test("Stage 6 auto-retries a non-stuck deploy failure without human escalation, bounded, but still escalates immediately when stuck", () => {
  const source = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");

  expect(source).toContain("const MAX_AUTO_RETRIES = 3");
  expect(source).toContain("if (autoRetryEnabled && !deployResult.stuck && autoRetryCount < MAX_AUTO_RETRIES)");

  // the auto-retry branch must `continue` the loop, not fall through into
  // the human-escalation call below it — otherwise this is dead code that
  // never actually skips the escalation.
  const autoRetryIdx = source.indexOf("if (autoRetryEnabled && !deployResult.stuck && autoRetryCount < MAX_AUTO_RETRIES)");
  const nextEscalateIdx = source.indexOf("escalateAndAwaitRetryDecision(escalationReason)");
  const continueIdx = source.indexOf("continue;", autoRetryIdx);
  expect(continueIdx).toBeGreaterThan(autoRetryIdx);
  expect(continueIdx).toBeLessThan(nextEscalateIdx);
});

// 2026-08-17: real nondeterminism error hit LIVE on an in-flight workflow
// (project-build-fulfillio1-deploy-resume) — the auto-retry branch above
// was first shipped without its own patched() guard. Its history already
// had a stuck-state-retry-signal-v1 marker recorded at this point (from the
// OLD code, which always reached escalateAndAwaitRetryDecision); replaying
// that history through the new code took the new `continue` branch instead
// whenever deployResult.stuck was false, never re-reaching the old
// patched() call, and Temporal correctly refused to proceed ("[TMPRL1100]
// Non-deprecated patch marker encountered... but there is no corresponding
// change command"). Verifies patched() is called UNCONDITIONALLY right
// before the auto-retry check, the same convention every other patch
// marker in this file already follows — never make the CALL to patched()
// itself conditional on other runtime state.
test("the auto-retry branch is gated by its own patched() marker, called unconditionally before the check", () => {
  const source = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");

  expect(source).toContain('const autoRetryEnabled = patched("auto-retry-non-stuck-deploy-v1")');
  const patchedIdx = source.indexOf('const autoRetryEnabled = patched("auto-retry-non-stuck-deploy-v1")');
  const autoRetryIdx = source.indexOf("if (autoRetryEnabled && !deployResult.stuck && autoRetryCount < MAX_AUTO_RETRIES)");
  // patched() must be called on its own line, unconditionally, immediately
  // before the branch that reads its result — not inlined inside the `if`
  // condition itself, where it could end up not being called at all
  // depending on evaluation order of the other conditions.
  expect(patchedIdx).toBeGreaterThan(-1);
  expect(patchedIdx).toBeLessThan(autoRetryIdx);
});

// 2026-08-17: real, third-order instance of the SAME context-chain false-
// positive class already fixed twice at the WORKFLOW level (see
// recordDeployHandoffActivity's own header comment) — this one lives one
// layer lower, in Temporal's OWN activity-level retry. runDeployWithLiveRetest
// used to share orchestratorAct's maximumAttempts: 2 — confirmed live
// (project-build-fulfillio1-deploy-resume) that Temporal silently retried
// the WHOLE activity on a genuinely transient "Unable to connect" network
// error (the failed activity's own `attempt` field was 2 in the real
// error), re-running its internal verifyHandoff against a stale snapshot
// from before attempt 1's real, legitimate deploy-config edits — a
// guaranteed false mismatch the workflow's own record-before-each-attempt
// pairing never got a chance to prevent, since Temporal's retry happens
// one layer below where that pairing runs. Moved to its own dedicated
// proxy with maximumAttempts: 1, so the workflow loop (which already
// handles retry decisions for this exact activity correctly) is the only
// layer retrying it.
test("runDeployWithLiveRetest uses its own dedicated proxy with maximumAttempts: 1, not orchestratorAct's shared retry policy", () => {
  const source = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");

  expect(source).toContain("const deployRetestAct = proxyActivities<typeof activities>({");
  const proxyIdx = source.indexOf("const deployRetestAct = proxyActivities<typeof activities>({");
  const proxyBlockEnd = source.indexOf("});", proxyIdx);
  const proxyBlock = source.slice(proxyIdx, proxyBlockEnd);
  expect(proxyBlock).toContain("maximumAttempts: 1");

  // the actual call site must use the new proxy, not still route through
  // orchestratorAct — otherwise the dedicated proxy above is dead code.
  expect(source).toContain("deployResult = await deployRetestAct.runDeployWithLiveRetest(projectId);");
  expect(source).not.toContain("deployResult = await orchestratorAct.runDeployWithLiveRetest(projectId);");
});

// 2026-08-10: real bug found live (project rivhdw1) — Stage 3 (parallel
// generation) had NO handling at all for a generator activity failure
// (e.g. generatorFailure()'s max-iterations-exceeded, deliberately
// nonRetryable so Temporal doesn't blindly retry the identical prompt/
// budget). Promise.all's rejection propagated straight out of the
// workflow function with zero catch — killing the ENTIRE workflow
// execution outright, the exact "unconditional termination, no resume
// path" class of bug the three escalations above were already fixed for,
// just never extended to cover generation itself. Confirmed live: Aanya's
// max-iterations failure on rivhdw1 terminated the whole workflow with no
// way to resume the same run.
test("Stage 3 generation failures are caught and retried via the same escalation pattern, not left to kill the whole workflow", () => {
  const source = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");

  expect(source).toContain('escalateAndAwaitRetryDecision("generation_failed")');
  expect(source).toContain('await act.markProjectFailed(projectId, "generation_failed")');
  const escalateCall = 'escalateAndAwaitRetryDecision("generation_failed")';
  const failCall = 'await act.markProjectFailed(projectId, "generation_failed")';
  expect(source.indexOf(escalateCall)).toBeLessThan(source.indexOf(failCall));
  // Promise.all(genPromises) must be wrapped in a try/catch, not called bare
  // — a bare call with no surrounding try means the rejection was never
  // actually caught by anything, regardless of what escalation code exists
  // elsewhere in the file.
  expect(source).toMatch(/try\s*\{\s*await Promise\.all\(genPromises\);/);
});
