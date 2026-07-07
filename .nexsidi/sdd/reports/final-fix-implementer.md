# Final Whole-Branch Fix Report

Status: DONE

## F1: Stage 4-6 wiring

`pipeline/orchestrator/run.ts`'s `runPipelineWithStages` (the pure, injectable
sequencing function `run.test.ts` exercises) now runs the full 6 stages in
one call:

```
stage1 -> checkpoint "01-requirements"
stage2 -> checkpoint "02-gateway"
  if decision !== "proceed" -> STOP (unchanged from before)
stage3 -> checkpoint "03-ui-preview"
  if !stage3Result.locked -> STOP (new gate — Stage 3's own human approval
    gate can decline; nothing has been generated yet, so there's nothing to
    roll back)
stage4(projectId, stage1Result.plan, stage1Result.dag) -> checkpoint "04-dev"
stage5(projectId, stage4Result) -> checkpoint "05-qa"
  if !stage5Result.pass -> STOP (new gate — Stage 6 does not deploy a build
    that failed adversarial QA)
stage6(projectId, stage4Result) -> checkpoint "06-deployment"
```

`Stage1Output` was extended with a `dag: unknown` field (Stage 1's real
`runStage1` already returns `{spec, plan, dag}` — only `dag` was being
dropped on the floor before). Three new local interfaces
(`Stage4Output`/`Stage5Output`/`Stage6Output`) mirror the real
`Stage4Result`/`Stage5Result`/`Stage6Result` shapes structurally, following
the same "hand-rolled, not imported — keeps run.test.ts's stubs decoupled
from agent internals" convention `Stage1Output`/`Stage3Output` already used.

`runPipeline` (the real entry point) dynamically imports all 6 stage modules
and wires them into `runPipelineWithStages`. Only `stage4` needed an adapter
lambda (`(pid, plan, dag) => runStage4(pid, plan as BuildPlan, dag as Dag)`)
because `runStage4`'s real signature takes typed `BuildPlan`/`Dag`, not
`unknown` — `BuildPlan`/`Dag` are imported as `import type` only, so this
adds zero runtime coupling to Arjun's real code (consistent with the file's
stated goal of never transitively pulling in live-LLM agent code at
module-eval time). `stage5`/`stage6` are structurally identical to their
slots and needed no adapter.

New tests added to `run.test.ts` covering the extended sequencing: all six
stages run in order with all six checkpoints written; Stage 4 does NOT run
when Stage 3 declines (`locked: false`); Stage 6 does NOT run when Stage 5
fails; and Stage 1's `dag` is correctly threaded into Stage 4 while Stage 4's
result is threaded into both Stage 5 and Stage 6. The two pre-existing tests
that reach a locked Stage 3 were extended with Stage 4-6 stubs since the
pipeline now continues past them.

## F2: Stage 6 stub swap

`stage6-deployment.ts`'s `runStage6` no longer defaults to
`runLiveRetestStub`. The default `deps` parameter is now constructed per-call
(so it can close over that call's own `stage4Result`):

```ts
deps: Stage6Deps = {
  deployFn: runRiya,
  liveRetestFn: (pid, appUrl) => runRealLiveRetest(pid, appUrl, stage4Result),
}
```

`runRealLiveRetest` dynamically imports and calls the REAL
`runStage5(projectId, stage4Result)` — confirmed its signature is exactly
`(projectId: string, stage4Result: Stage4Result) => Promise<Stage5Result>`,
so Stage 6 passes its own `stage4Result` straight through unmodified (see
Concerns below for why this is correct, not a guess). It also temporarily
points `process.env.TIER3_REVIEW_URL` at the just-deployed `appUrl` for the
duration of the call (restoring whatever was there before in a `finally`),
since Tilotma's Tier 3 evidence collector — the one part of Stage 5 that
genuinely screenshots a live URL — reads its target from that env var, not
from a parameter.

`runLiveRetestStub` is kept and now exported, explicitly as an opt-in stub
for callers/tests that want to bypass a real QA re-run — no longer the
default. The stale header comment ("As of this task (Task 13), Task 12 ...
has NOT landed yet") was rewritten to describe the current, real wiring.

## F4: Checkpoint consistency

Final stage-id naming, all six now consistent:
`"01-requirements"`, `"02-gateway"`, `"03-ui-preview"`, `"04-dev"`,
`"05-qa"`, `"06-deployment"`.

- Stage 3's internal `writeCheckpoint` call (previously keyed
  `"03-design-lock"`, written before the human decision is known so a crash
  during the up-to-30-minute approval poll doesn't lose the fact that
  Aanya's preview build already succeeded) now writes under `"03-ui-preview"`
  — the same key `run.ts` writes with the final, decision-inclusive result
  right after. One key, one file per stage; the interim write is simply
  superseded once the decision resolves. Confirmed via grep that nothing
  anywhere reads `"03-design-lock"`, so this was pure dead-weight drift, not
  a case of "both are genuinely needed under different keys."
- Stages 4/5/6 are now checkpointed — not by adding `writeCheckpoint` calls
  inside the stage files themselves, but by `runPipelineWithStages`, exactly
  matching how Stages 1/2 (and now Stage 3's authoritative record) are
  checkpointed today. This keeps checkpointing owned in one place.

All 6 stages now checkpoint. Confirmed via the new `run.test.ts` test
(`runPipelineWithStages runs all six stages in order and checkpoints each
one when everything proceeds`), which asserts all six checkpoint files via
`readCheckpoint`.

## F5: Path-traversal fixes

`checkpoint.ts`'s `assertValidIdentifier` is now `export`ed (it previously
existed only as a module-private function, independently duplicated in
`gateway.ts`). Applied via import (not reimplementation) at both flagged
locations:

- `pipeline/orchestrator/stages/stage4-multi-agent-dev.ts`
  `getProjectKeyPair(projectId)` — now calls
  `assertValidIdentifier(projectId, "projectId")` as its first line, before
  any path is built with `join(buildDir, projectId, "keys")`. Imported via
  `import { assertValidIdentifier } from "../checkpoint.ts";` (same
  directory tree, trivial relative import — stage1/stage3 already import
  `writeCheckpoint` from the same file).
- `agents/tilotma/src/tier3-review.ts` `runTier3Review(projectId, ...)` —
  same guard call added before `join(SCREENSHOT_ROOT, projectId)`. Imported
  via `import { assertValidIdentifier } from "../../../pipeline/orchestrator/checkpoint.ts";`
  — a new cross-directory import (agents/tilotma -> pipeline/orchestrator),
  but not circular: `checkpoint.ts` has zero imports back into `agents/`, and
  it's a value import used only inside the function body, so no live-LLM
  code gets pulled in at module-eval time.

Added two regression tests in `stage4-multi-agent-dev.test.ts`
(`getProjectKeyPair throws on a path-traversal projectId...` /
`...on a projectId containing a path separator`) — cheap because
`assertValidIdentifier` throws before any filesystem I/O happens, so no
temp-dir setup is needed. `tier3-review.ts`'s guard was NOT given a
dedicated test: `runTier3Review` calls a live LLM (`runAgent`) and its
existing test file (`tier3-review.test.ts`) only exercises the pure
`parseFindings` helper, with no mocking harness for `runAgent` established
anywhere in this codebase yet — adding one would be a larger, separate
change. The guard function itself is already covered by
`checkpoint.test.ts`'s and `gateway.test.ts`'s existing traversal tests plus
the two new stage4 tests, so the logic is verified; only this one call site
lacks a dedicated regression test.

## Test output

Full requested command, run twice for consistency (matching the reviewer's
own verification method):

```
$ bun test pipeline/orchestrator/ packages/agent-runtime/ packages/context-chain/ agents/qa/ agents/tilotma/ agents/riya/ agents/generators/
bun test v1.3.14 (0d9b296a)

 76 pass
 0 fail
 130 expect() calls
Ran 76 tests across 16 files. [722.00ms]
```

(Baseline before this fix was 70 pass / 110 expect() / 16 files per the
review. +6 pass / +20 expect() from: 4 new run.test.ts tests covering the
Stage 4-6 wiring, 2 pre-existing run.test.ts tests extended with Stage 4-6
stubs (not new tests, same count), and 2 new stage4 path-traversal tests.)

Also re-ran `bunx tsc --noEmit -p pipeline/tsconfig.json` to confirm no new
type errors were introduced by this fix. Same pre-existing errors as before
(F6, explicitly out of scope) remain, all in files this fix did not touch:
`agents/tilotma/src/orchestrator.ts` (1), `packages/agent-runtime/src/loop.ts`
(8), `packages/agent-runtime/src/tools/command.ts` (2). None of the 8 files
this fix changed introduce any new typecheck error.

## Commit

`5b427a706a6e4ea8ef0aefefa181bb47175674d8`

Files: `agents/tilotma/src/tier3-review.ts`, `pipeline/orchestrator/checkpoint.ts`,
`pipeline/orchestrator/run.test.ts`, `pipeline/orchestrator/run.ts`,
`pipeline/orchestrator/stages/stage3-ui-preview.ts`,
`pipeline/orchestrator/stages/stage4-multi-agent-dev.test.ts`,
`pipeline/orchestrator/stages/stage4-multi-agent-dev.ts`,
`pipeline/orchestrator/stages/stage6-deployment.ts`.

## Concerns

1. **Stage 6's "post-deploy output dir" question (raised in the fix brief) —
   resolved, not deferred.** I read both `stage4-multi-agent-dev.ts` and
   `stage6-deployment.ts` carefully: Riya's `run()` (the real `deployFn`)
   takes `(projectId, deployTarget)` — it has no separate "post-deploy output
   dir" concept at all. Both the pre-existing `void stage4Result;` comment in
   Stage 6 (now removed, since stage4Result is genuinely consumed) and Riya's
   signature confirm Riya deploys whatever Stage 4 already wrote to
   `BUILD_DIR/{projectId}/...` — the same convention every stage uses. So
   Stage 4's pre-deploy `backendOutputDir`/`frontendOutputDir` are still
   correct to re-scan post-deploy; there is no dir mismatch to reconcile.
   This was a real read, not a guess, but flagging it here since the brief
   explicitly called it out as something to verify rather than assume.

2. **Stage 5 fail -> Stage 6 skip gate, and the fault-isolated re-fix loop.**
   The task brief's F1 instructions describe wiring stages "4, then 5, then
   6" sequentially with checkpointing, and separately note (in the review's
   own recommendation text, not the fix brief) that a full design would
   "handle Stage 5 fail -> fault-isolated re-fix -> full retest." Implementing
   a real re-fix loop (re-invoking Shubham/Aanya/Pranav based on
   `faultAgent`, re-running Stage 5, with iteration tracking) is a
   substantially larger feature and explicitly out of this fix's stated
   scope (only F1/F2/F4/F5, not a new retry system). I made the narrower,
   safer call: gate Stage 6 on `stage5Result.pass` so a failed adversarial QA
   run stops the pipeline rather than silently deploying unvetted code.
   `stage5Result.faultAgent` is preserved in the checkpointed `"05-qa"`
   result for a future re-fix loop to consume, but nothing currently acts on
   it automatically. This is the one place I made a judgment call beyond the
   brief's literal wording — noting it here as instructed rather than asking.

3. **F3 (Navya/Deepika stub agents) is untouched, as instructed.** Stage 5's
   wiring calls their existing (stub) `run()` functions exactly as before —
   `score: 100, findings: [], passed: true` always — so Stage 5's
   `navyaResult.passed && deepikaResult.passed` remains a no-op pass. This
   was pre-existing and explicitly out of scope for this fix.

4. **F6 (loop.ts / tsc typecheck) remains unfixed, as instructed** (it was
   not part of this fix's F1/F2/F4/F5 scope). Confirmed no new errors were
   added by this fix's changes; the pre-existing 11 errors are exactly where
   the review found them.
