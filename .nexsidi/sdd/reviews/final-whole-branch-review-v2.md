# Final Whole-Branch Review v2 (after F1/F2/F4/F5 fix)

Verdict: APPROVED

Reviewer: fresh whole-branch reviewer (did not write any of this code). Re-verified each finding by reading current on-disk source and running the suite myself, not by trusting `final-fix-implementer.md`. Scope: MERGE_BASE `feac323` -> HEAD `5b427a7` (the fix commit sits on top of everything reviewed in v1). Working tree clean; only untracked `.nexsidi/sdd/` docs.

---

## F1: Stage 4-6 wiring — verified?

**YES — genuinely wired, traced by hand.**

`pipeline/orchestrator/run.ts` `runPipelineWithStages` (lines 88-122) now sequences all six stages with three gates. Traced the real call chain literally:

1. `stage1` -> checkpoint `01-requirements`.
2. `stage2(spec)` -> checkpoint `02-gateway`. **Gate:** `if (decision.decision !== "proceed") return;` (line 99) — halts before Stage 3.
3. `stage3(plan)` -> checkpoint `03-ui-preview`. **Gate:** `if (!stage3Result.locked) return;` (line 106) — halts before Stage 4.
4. `stage4(plan, dag)` -> checkpoint `04-dev`.
5. `stage5(stage4Result)` -> checkpoint `05-qa`. **Gate:** `if (!stage5Result.pass) return;` (line 116) — halts before Stage 6.
6. `stage6(stage4Result)` -> checkpoint `06-deployment`.

`runPipeline` (the real entry point, lines 125-154) `Promise.all`-imports all six real stage modules and injects them into `runPipelineWithStages`. Only `stage4` needs an adapter lambda (`(pid, plan, dag) => runStage4(pid, plan as BuildPlan, dag as Dag)`), because `runStage4`'s real signature takes typed `BuildPlan`/`Dag`; `BuildPlan`/`Dag` are `import type` only, so no runtime coupling to live-LLM agent code at module-eval time. `stage5`/`stage6` slot in directly.

A real `runPipeline(projectId, userInput)` call now genuinely reaches Stage 6 on the happy path. The three gates are correctly placed: the pipeline halts on rejection at each gate and continues on success. Data threading is correct — `stage1Result.plan` -> stage3 and stage4; `stage1Result.dag` -> stage4; `stage4Result` -> both stage5 and stage6.

The wiring is not just claimed — `run.test.ts` exercises it with 4 new tests: all-six-in-order + six checkpoints (lines 145-185), stage4-skipped-when-stage3-declines (187-219), stage6-skipped-when-stage5-fails (221-256), and dag/stage4Result threading (258-288). The two pre-existing "proceed" tests were extended with Stage 4-6 stubs. **F1 resolved.**

## F2: Stage 6 stub swap — verified?

**YES — the real `runStage5` is now the default, per-call closure confirmed.**

`stage6-deployment.ts`:
- `runStage6`'s default `deps` (lines 143-146) is constructed *inside the parameter list per call*, so `liveRetestFn: (pid, appUrl) => runRealLiveRetest(pid, appUrl, stage4Result)` closes over that specific call's `stage4Result`. This is real, not claimed — the default is a per-call arrow, not a module-level constant, which is exactly what's required to capture `stage4Result`.
- `runRealLiveRetest` (lines 105-124) does `const { runStage5 } = await import("./stage5-adversarial-qa.ts")` and calls `runStage5(projectId, stage4Result)`. I confirmed the real signature in `stage5-adversarial-qa.ts:185`: `runStage5(projectId: string, stage4Result: Stage4Result): Promise<Stage5Result>` — matches exactly, `stage4Result` passes straight through.
- It temporarily sets `process.env.TIER3_REVIEW_URL = appUrl` and restores the prior value in a `finally` (lines 112-123). `tier3-review.ts:48` does read the target from `TIER3_REVIEW_URL`, so this wiring genuinely points the live screenshot review at the deployed URL. Correct.
- `runLiveRetestStub` (lines 78-84) is **kept and exported**, now explicitly opt-in (still `console.warn`s + returns `{pass:true, findings:[]}`). It is no longer the default.
- The stale "Task 12 has NOT landed yet" header comment was rewritten to describe the real wiring.

Regression check on stub tests: `stage6-deployment.test.ts` (all 6 tests) pass their own `deps` with an injected `liveRetestFn` — none rely on the default, so swapping the default did not break any existing stub-based test. Confirmed green. **F2 resolved.**

## F4: Checkpoint consistency — verified?

**YES — one key per stage, all six write checkpoints, drift gone.**

Grepped every `writeCheckpoint(` call in `.ts` source. Full set now:
- `run.ts`: `01-requirements`, `02-gateway`, `03-ui-preview`, `04-dev`, `05-qa`, `06-deployment` (lines 94/97/104/111/114/121).
- `stage3-ui-preview.ts:49`: writes the interim record under `03-ui-preview` (the SAME key run.ts uses right after the human decision resolves — the post-decision write supersedes it). Previously this was `03-design-lock`.

Grepped `03-design-lock` across all source: it appears **only** in the explanatory comment at `stage3-ui-preview.ts:42`, the plans doc, and old diffs/reports — **zero live references in any `.ts` source**. Confirmed nothing reads `03-design-lock`; it was pure dead-weight drift, correctly eliminated (not renamed to another drifting key).

Stages 4-6 are now checkpointed — by `runPipelineWithStages` (single-owner checkpointing, same as Stages 1-2), not by adding writes inside the stage files. Crash-resume past Stage 3 is now possible. The `run.test.ts` "all six stages" test asserts all six checkpoint files exist via `readCheckpoint`, and the two gate-skip tests assert `04-dev`/`05-qa`/`06-deployment` are `null` when a gate blocks. **F4 resolved.**

## F5: Path-traversal fixes — verified?

**YES — guard imported and called in both flagged files; concrete attack rejected.**

`assertValidIdentifier` is now `export`ed from `checkpoint.ts:11` with regex `INVALID_IDENTIFIER = /\.\.|\/|\\/` (rejects `..`, `/`, `\`).

- `stage4-multi-agent-dev.ts`: imports it (line 35) and calls `assertValidIdentifier(projectId, "projectId")` as the **first line** of `getProjectKeyPair` (line 88), before any `join(buildDir, projectId, "keys")` / `writeFileSync`. Not just claimed — verified in source.
- `tier3-review.ts`: imports it (line 27) and calls `assertValidIdentifier(projectId, "projectId")` (line 45) before `join(SCREENSHOT_ROOT, projectId)` (line 49) and `mkdirSync` (line 50). Verified in source. The cross-directory import (`agents/tilotma` -> `pipeline/orchestrator/checkpoint.ts`) is a value import used only inside the function body; `checkpoint.ts` imports nothing back into `agents/`, so no circularity and no live-LLM code pulled at module-eval time.

Concrete attack, traced: `projectId = "../../evil"` contains both `..` and `/` -> regex matches -> `assertValidIdentifier` throws `Invalid projectId: "../../evil"...` before any filesystem path is constructed, in BOTH `getProjectKeyPair` and `runTier3Review`. Would be rejected. This is directly covered by two new `stage4-multi-agent-dev.test.ts` tests (`getProjectKeyPair("../../escaped")` and `getProjectKeyPair("some/nested/id")`, lines 10-16, both asserting `toThrow(/Invalid projectId/)`) — I ran these, they pass.

`tier3-review.ts`'s guard has no dedicated regression test (its enclosing function calls a live LLM with no mock harness in-repo), but the guard *function* is covered by checkpoint/gateway/stage4 traversal tests, and the call site is verified present by reading source. Acceptable — the honestly-flagged one gap in the fix report. **F5 resolved.**

## Full test suite results

Ran the exact requested command twice for consistency:

```
$ bun test pipeline/orchestrator/ packages/agent-runtime/ packages/context-chain/ agents/qa/ agents/tilotma/ agents/riya/ agents/generators/
 76 pass
 0 fail
 130 expect() calls
Ran 76 tests across 16 files. [~0.7s]
```

Matches the fix report's claimed 76/0/130/16 exactly (v1 baseline was 70/0/110/16; +6 pass / +20 expect from the 4 new run.test.ts wiring tests and 2 new stage4 path-traversal tests). Consistent across both runs.

**Typecheck (F6, out of scope) unchanged:** `bunx tsc --noEmit -p pipeline/tsconfig.json` reports exactly **11 pre-existing errors**, all in files this fix did NOT touch — `agents/tilotma/src/orchestrator.ts` (1), `packages/agent-runtime/src/loop.ts` (8, the `ToolResult`-not-`Record<string,unknown>` root error), `packages/agent-runtime/src/tools/command.ts` (2). None of the 8 files this fix changed introduce any new type error. The fix report's typecheck claim is accurate. (Note: v1 counted ~13; the delta is v1 counting nested "Overload N of 8" sub-lines — the distinct `error TS` count is 11 both before and after. No new errors either way.)

## Regression check on Stages 1-3

**No regression. Stage 1-3 gating logic is unchanged/still correct.**

- Stage 1 (`stage1-requirements.ts`): unchanged — still `runSaanvi` then `runArjun(spec)`, returns `{spec, plan, dag}`. The `dag` field was already produced; run.ts previously dropped it and now threads it to Stage 4. No behavior change in Stage 1 itself.
- Stage 2 gate: `decision.decision !== "proceed"` -> `return` (run.ts:99) — identical to v1.
- Stage 3 gate: the `!stage3Result.locked -> return` gate (run.ts:106) is NEW, but it is a correct extension, not a change to prior behavior. Previously Stage 3 was the last stage and the pipeline ended after it regardless; now `locked: false` cleanly halts before Stage 4 (nothing generated yet -> nothing to roll back). `stage3-ui-preview.ts` still throws on build failure, still polls the gateway, still returns `{locked, outputDir}` — the only change is the checkpoint key (`03-design-lock` -> `03-ui-preview`), which is the F4 fix and is inert w.r.t. gating.
- The two pre-existing run.test.ts tests that reach a locked Stage 3 were extended with Stage 4-6 stubs (necessary, since the pipeline now continues past Stage 3) — not weakened; their Stage 1-3 assertions are intact (e.g. the "stops at unapproved gateway" test still asserts `calls === ["stage1","stage2"]` and `03-ui-preview` is null).

Stage 1-3 checkpoint/gateway/gating tests all still green in the 76-pass run.

## Judgment call assessment (Stage 6 gating on Stage 5 failure)

**Reasonable scope boundary — NOT a broken failure path.**

The fix gates Stage 6 on `stage5Result.pass` (halt rather than deploy unvetted code) instead of implementing a full fault-isolated re-fix-and-retest loop. Assessment:

- On QA failure the pipeline does NOT crash and does NOT return anything misleading. `runPipelineWithStages` writes the `05-qa` checkpoint (recording `pass:false`, the full `findings` list, and `faultAgent`) and then `return`s cleanly (run.ts:116-118). No throw, no silent success.
- This is the **exact same contract** the pipeline already used at the Stage 2 and Stage 3 gates: `runPipelineWithStages` returns `Promise<void>` and halts silently on any gate block, leaving the outcome recorded in checkpoints for a caller/resume routine to inspect. The new Stage 5 gate is consistent with that established, previously-approved pattern — it is not a new failure mode with different ergonomics.
- `faultAgent` is preserved in the checkpoint for a future re-fix loop to consume; nothing acts on it automatically yet. That is an honestly-declared, appropriately-scoped deferral (a real retry system is a substantially larger feature than F1/F2/F4/F5).

Not deploying unvetted code on QA failure is strictly safer than the alternatives. The only mild caveat (pre-existing, not introduced here): because the pipeline returns `void`, a caller cannot distinguish "delivered through Stage 6" from "halted at a gate" without reading checkpoints. That is the existing design contract, out of scope for this fix, and not a regression.

## Previously-clean items re-confirmed

- **Confidentiality:** No hardcoded internal agent name reaches a user-facing surface. `buildDeliverySummary` (stage6) returns only `status`/`appUrl`/`githubRepo` and has a dedicated test asserting none of `INTERNAL_AGENT_NAMES` appear. All `throw new Error(...)` in `pipeline/orchestrator/` (checkpoint/gateway/stage2/stage3) use generic stage labels + projectId only — grepped and inspected, no agent names. The new run.ts comments/strings contain agent names only in code comments (never a runtime string). Agent names in `identifyFaultAgent` returns and `faultAgent` remain internal routing data in the `05-qa` checkpoint, never surfaced. Unchanged and clean. (Pre-existing F11 — stage3 rethrows LLM-produced `result.errors` — is untouched, still low-severity.)
- **Known risk 1 (Arjun runs inside Stage 1, before the Stage 2 "nothing to roll back" gate):** still true and unchanged. `stage1-requirements.ts` still calls `runSaanvi` then `runArjun`. Accurately flagged in v1 as a doc-text discrepancy; neither fixed nor newly broken.
- **Known risk 2 (`faultAgent` defaults to `"shubham"` for non-Karan findings):** still true and unchanged. `identifyFaultAgent` (stage4:52-58) still returns `"shubham"` when `findings[0].file` doesn't match a known prefix; Navya/Deepika findings still map to `file: ""` in stage5 (`navyaFindingToFinding`/`deepikaFindingToFinding`). Honestly commented in `stage5-adversarial-qa.ts:57-70`. Correctly scoped, unchanged.

## Findings

Real severity per D42 (🔴 blocking / 🟡 should-fix / 🟢 optional / 💡 suggestion).

**All four fixed blockers/should-fixes are resolved:**
- ✅ F1 (was 🔴) — Stages 4-6 now genuinely wired into `runPipeline`; happy path reaches Stage 6; three gates correct; covered by new tests.
- ✅ F2 (was 🔴) — Stage 6 default `liveRetestFn` now calls the real `runStage5` via a correct per-call closure over `stage4Result`; stub kept as opt-in export; existing stub tests unbroken.
- ✅ F4 (was 🟡) — one checkpoint key per stage; `03-design-lock` drift eliminated (zero live refs); Stages 4-6 now checkpoint.
- ✅ F5 (was 🟡) — `assertValidIdentifier` exported and called in both `getProjectKeyPair` and `runTier3Review`; traversal attempt rejected; new stage4 tests.

**Still-open items (all explicitly out of this fix's scope, honestly declared):**

🟡 **F3 — Navya and Deepika are inert stubs wired into a live gate.** Pre-existing, explicitly OUT of scope for this fix. Both still hardcode `score:100, findings:[], passed:true`, so Stage 5's `navyaResult.passed && deepikaResult.passed` is always true — only Karan does real work. Unchanged by this branch's fix; must be tracked for the next milestone. Not a blocker for *this* fix's contract, but the pipeline's adversarial gate is 1-of-3 real until this lands.

🟡 **F6 — Typecheck not clean (11 pre-existing errors).** Explicitly out of scope. No new errors introduced by this fix. `loop.ts` `ToolResult` index-signature root cause remains. No green `tsc` gate on the branch.

🟢 **F7 — Mandatory 3 incremental stress-test app runs not evidenced in PROGRESS.md.** Downstream of F1 — now *unblocked* by the wiring, but not run/recorded as part of this fix. These end-to-end runs are the only thing that would prove a real `runPipeline` call produces a working app (the suite proves plumbing, not end-to-end output). Recommend running them next; not a blocker for approving the wiring fix itself, but the branch's own acceptance criterion is not yet fully evidenced.

🟢 **F8 — `faultAgent` misattribution for logic/perf-only failures** (defaults to `"shubham"`). Unchanged, honestly commented. Tracks with F3.

🟢 **F9 — Design doc's "Stage 2: nothing to roll back" text is stale** (Arjun runs in Stage 1). Doc-only reconciliation, deferred.

💡 **F10 — `dag` param to `runStage4` is decorative** (`void dag`; ordering hardcoded from `independenceVerified`). Now genuinely threaded through run.ts, but still not consumed for scheduling. Acceptable for now.

💡 **F11 — Stage 3 rethrows LLM-produced `result.errors` into a thrown error.** Untouched, low, scrub if it can reach a user.

## Recommendation

**APPROVED.**

All four items this fix targeted — F1, F2, F4, F5 — are genuinely resolved in on-disk source, not merely claimed: I traced the call chain by hand, constructed the traversal attack mentally against both call sites, grepped every checkpoint key, confirmed the per-call closure, and ran the suite twice (76/0/130/16, matching the report). The fix touched `run.ts`, `checkpoint.ts`, and multiple stage files without regressing the previously-approved Stage 1-3 gating, confidentiality, or the two known-and-accepted risks. The Stage 6-gated-on-Stage-5 judgment call is a reasonable, safe scope boundary that halts cleanly (no crash, no misleading return) rather than deploying unvetted code, and is consistent with the pipeline's existing gate contract.

The remaining open items (F3 inert Navya/Deepika, F6 typecheck, F7 stress-test evidence) were all explicitly out of scope for this fix and are honestly declared. They do NOT block approval of *this* fix, but they are the natural next milestone: the pipeline now runs end-to-end, but two of three adversarial QA tiers are still stubs (F3), the branch doesn't typecheck green (F6), and the mandatory end-to-end stress-test runs — now unblocked by F1 — should be executed and recorded in PROGRESS.md (F7) before the pipeline is considered production-trustworthy. Recommend opening follow-up tasks for F3/F6/F7; the whole-branch wiring build itself is done and correct.
