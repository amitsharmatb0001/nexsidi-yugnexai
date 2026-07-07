# Final Whole-Branch Review

Verdict: NEEDS_FIXES

Reviewer: fresh whole-branch reviewer (did not write any of this code). Scope: MERGE_BASE `feac323` → HEAD (`0986c35`), 22 commits, traced on-disk source rather than trusting per-task approvals.

---

## End-to-end wiring trace

**Critical gap: `runPipeline` stops at Stage 3. Stages 4, 5, and 6 are orphaned.**

`pipeline/orchestrator/run.ts` `runPipeline(projectId, userInput)` dynamically imports and runs only `runStage1`, `runStage2`, `runStage3` via `runPipelineWithStages`. There is no `runStage4`/`runStage5`/`runStage6` call anywhere in the real call chain.

I grep'd the entire repo (excluding docs). The ONLY references to `runStage4`, `runStage5`/`runStage5WithAgents`, and `runStage6` outside their own definition files are:
- their own `.test.ts` files, and
- cross-imports between the three stage files for *types* (`Stage4Result`) and helpers (`identifyFaultAgent`).

No production entry point (no CLI, no API route, no Temporal activity, not `run.ts`) ever invokes them. `runPipelineWithStages` — the only thing that checkpoints — has a hardcoded 3-stage body (`PipelineStages` interface has exactly `stage1/stage2/stage3`). So a real `runPipeline()` call:
1. Runs Stage 1 (Saanvi + Arjun), checkpoints `01-requirements`.
2. Runs Stage 2 gateway, checkpoints `02-gateway`.
3. If proceed, runs Stage 3 UI preview, checkpoints `03-ui-preview`, and **returns — pipeline ends.**

The design's headline deliverable ("URL + repo + feature list", produced by Stage 6) is unreachable. Stages 4–6 were each built and unit-tested in isolation but never integrated. This is precisely the cross-task integration gap the per-task reviews could not catch. **Blocking.**

---

## Checkpoint consistency

Inconsistent, and incomplete for the unwired stages.

- Stages 1–3 are checkpointed **by `run.ts`** (`runPipelineWithStages`) as `01-requirements`, `02-gateway`, `03-ui-preview` — consistent with the design's naming.
- **Drift at Stage 3:** `stage3-ui-preview.ts` *also* writes its own checkpoint internally, but keys it `03-design-lock` (line 40), while `run.ts` separately writes `03-ui-preview` for the same stage. Two different checkpoint keys describe one stage; the design specifies a single `03-ui-preview.json`. A resume routine keying off `03-ui-preview` would miss the design-lock record and vice versa.
- **Stages 4–6 write NO checkpoints at all.** Checkpointing lives only in `runPipelineWithStages`; `runStage4`/`runStage5`/`runStage6` never call `writeCheckpoint`. The design's `04-dev.json`, `05-qa.json`, `06-deployment.json` do not exist. So even if 4–6 were wired in, crash-resume past Stage 3 is impossible. Consequence of the wiring gap above, but a distinct defect.

---

## Cross-stage type consistency

The type *definitions* at the seams are clean and single-sourced (this part is good):
- `Stage4Result` is defined once in `stage4-multi-agent-dev.ts` and imported (not redefined) by both `stage5-adversarial-qa.ts` and `stage6-deployment.ts`.
- `Finding` and `identifyFaultAgent` are imported from Stage 4 by Stage 5 — the earlier duplicate-definition issue is genuinely resolved.
- Stage 5's real entry point adapts the QA agents' `(projectId, iteration, code)` signature and the tier3 `(projectId, frontendOutputDir)` signature correctly behind the `Stage5Agents` seam.

No silent `any`-widening *between* stage result types. However:
- `Stage6Result.findings` and `LiveRetestResult.findings` are typed `unknown` — acceptable for a stub boundary but means a real Stage 5 live-retest wiring will need a typed shape, not a drop-in.
- `runStage4(projectId, plan, dag)` — the plan doc's stated signature was `runStage4(projectId, dag)`. The implemented signature added `plan: BuildPlan` (correct and necessary), and `dag` is accepted but unused (`void dag`). Not a mismatch that hides a bug, but the DAG is decorative — ordering is hardcoded, not derived from the graph.

---

## Known-risk status check

Both previously-flagged risks are **still present and accurately described** — neither regressed, neither was fixed:

1. **Arjun runs inside Stage 1, before the Stage 2 "nothing to roll back" gate** (flagged task-10-review). Confirmed: `stage1-requirements.ts` calls `runSaanvi` then `runArjun(spec)` and returns `{spec, plan, dag}`. The design doc (Stage 2) still says "no agent work has started, nothing to roll back," but Arjun's full task decomposition + API contract + sprint-contract file writes (D23) now happen in Stage 1, before the gate. Accurate as flagged; the Task 10 fix report acknowledges this openly. Not newly broken, but the design text is now false for this path.

2. **Non-Karan QA failures default `faultAgent` to `"shubham"`** (flagged task-12-review). Confirmed: `identifyFaultAgent` reads `findings[0].file`; Navya/Deepika's real `Finding` type has no `file` field, so their findings map to `file: ""` and fall through to the `return "shubham"` default. Accurately described and honestly commented in `stage5-adversarial-qa.ts`. A logic/perf-only failure is always misattributed to the backend agent. Still a real limitation, correctly scoped.

---

## Stage 6 stub status

**The Stage 6 live-retest is still a stub, and Task 12's real `runStage5` was never wired in to replace it.**

- `stage6-deployment.ts` `defaultDeps.liveRetestFn = runLiveRetestStub`, which `console.warn`s and unconditionally returns `{ pass: true, findings: [] }`.
- The stub is still clearly and honestly marked (header comment + runtime warn) — it is NOT silently treated as real QA. Good.
- But the header comment ("As of this task (Task 13), Task 12 ... has NOT landed yet") is now **stale**: I confirmed commit order — Stage 6 (`f4d7325`, 07-02 11:04) landed *before* Stage 5 (`0986c35`, 07-02 17:07). Stage 5 now exists and exports `runStage5(projectId, stage4Result)`, but nobody went back to swap `runLiveRetestStub` for the real dynamic import. The swap the comment describes as the follow-up was never done.
- Net effect: the design's headline Stage 6 feature — re-running QA against the *live deployed* app to catch the Sprint-1 CORS/route-mount class of bug — does nothing. Deployment always "passes" its retest.

---

## Full test suite results

Ran exactly the requested command:
`bun test pipeline/orchestrator/ packages/agent-runtime/ packages/context-chain/ agents/qa/ agents/tilotma/ agents/riya/ agents/generators/`

**Result: 70 pass, 0 fail, 110 expect() calls, 16 files. [~0.6s]** — ran it myself, twice, consistent.

16 test files present and all green:
checkpoint, dag, flags, gateway, run, stage4, stage5, stage6 (pipeline/orchestrator); loop, screenshot, websearch (agent-runtime); verify (+ pre-existing hash/sign) (context-chain); scoring (karan); deploy-target (riya); tier3-review (tilotma); index (aanya).

Caveat: every stage test exercises only the deterministic seams (scoring, routing, checkpointing, gating, path guards) with injected stubs — by the plan's stated (and reasonable) philosophy that live-LLM tool-call sequences aren't unit-testable. So a green suite proves the plumbing, **not** that any stage produces working output end-to-end. The design's own acceptance criterion — the 3 incremental stress-test apps (Stages 1-3, 1-5, 1-6) — is nowhere evidenced in-repo; PROGRESS.md was not updated with stress-test results. Those stress tests are the only thing that would have caught the wiring gap, and they were not run.

**Typecheck is NOT clean.** `bunx tsc --noEmit -p pipeline/tsconfig.json` reports ~13 errors, all pre-existing files (`agents/tilotma/src/orchestrator.ts`, `packages/agent-runtime/src/loop.ts`, `packages/agent-runtime/src/tools/command.ts`). The stage files themselves are type-clean, but `loop.ts`'s `let result: Record<string, unknown>` root error (missing index signature on `ToolResult`) now also covers the **two new tool cases this branch added** (`web_search` line 160, `screenshot` line 164). Bun strips types so tests/runtime pass, but there is no green `tsc` gate on this branch.

---

## Confidentiality audit

I grepped the diff for all 9 (+ arjun/vanya) internal names and inspected every string literal that could reach a user-facing surface. **No hardcoded agent name reaches a user-facing surface.** Per-hit verdicts:

- `summarizeSpec()` (stage2) — gateway request summary the user reviews. Uses only `name`/`description`/`featureCount`. **Clean.**
- `buildDeliverySummary()` (stage6) — the one user-facing delivery output. Returns only `status`/`appUrl`/`githubRepo`, and has a dedicated test asserting none of `INTERNAL_AGENT_NAMES` appear. **Clean.**
- Stage 1/2/3 thrown errors — "Stage 2 gateway timed out…", "Stage 3 UI preview build failed for project X…". Generic stage labels, no names. **Clean.**
- Agent names in `identifyFaultAgent` returns (`"shubham"`/`"aanya"`/`"pranav"`) populate `Stage5Result.faultAgent` — **internal routing data only, never surfaced** (Stage 5 isn't even wired to output). Acceptable, but flagging: this field must never be added to a delivery/error surface later.
- `agentName: "tilotma-evidence-collector"` etc., `QA_SYSTEM_PROMPT` "You are Karan…", `AANYA_*` prompt constants, `signAndVerifyHandoff("pranav","shubham",…)`, `console.log`/`console.warn` lines — all internal (LLM system prompts, code identifiers, server-side logs). Never leave the server. **Not violations.**

One theoretical (non-hardcoded) surface: `stage3-ui-preview.ts` rethrows `result.errors.join("; ")` from Aanya, which is LLM-produced text. Not a hardcoded leak, but untrusted model output flows into a thrown error — worth a scrub/guard if that error ever reaches a user. Low.

---

## Security consistency check

**Inconsistent.** The path-traversal guard (`assertValidIdentifier`, rejecting `..`/`/`/`\`) added to `checkpoint.ts` and `gateway.ts` during their task reviews was **not applied to two newer files that build project-scoped filesystem paths from the same `projectId`:**

- `stage4-multi-agent-dev.ts` `getProjectKeyPair()` (line 88): `join(buildDir, projectId, "keys")` then `writeFileSync` the RSA keypair — no `projectId` validation.
- `agents/tilotma/src/tier3-review.ts` (lines 46–47): `join(SCREENSHOT_ROOT, projectId)` then `mkdirSync(join(process.cwd(), screenshotDir))` — no `projectId` validation, and rooted at cwd.

`projectId` is a bare function parameter threaded from `runPipeline(projectId, …)`; nothing in this branch guarantees it's a sanitized 12-char hash at the point these files use it (the caller that would set it doesn't exist yet). A `projectId` like `../../x` would place keys/screenshots outside the build dir. Not *currently* reachable (Stage 4/tier3 aren't wired in), so **Low/Medium**, but it's exactly the "did a later file skip the guard" pattern — and the guard already exists two files over, so consistency is cheap.

`dag.ts` builds no filesystem paths (pure graph) — safe. `screenshot.ts`'s own outputPath guard (cwd-escape via sibling-prefix) is correct and tested. `websearch.ts` touches no filesystem. The `pipeline/activities/index.ts` `projectId` path uses are pre-existing legacy code, out of scope.

---

## Repo state verification

**Clean. No trace of the double-stash-pop incident.**

- `git stash list`: exactly one entry — `stash@{0}: WIP on feat/nexsidi-pipeline-v2: 23ba262 …`. This is the single original, untouched pre-existing stash. Nothing popped, nothing re-stashed.
- `git status`: only untracked `.nexsidi/sdd/` report/review/progress files. No modified tracked files, no stray edits, no partial merges. Working tree matches HEAD.
- On branch `claude/eager-varahamihira-967edb`, 22 commits ahead of `feac323`.

---

## Findings

Real severity per D42 (🔴 blocking / 🟡 should-fix / 🟢 optional / 💡 suggestion).

**🔴 F1 — Stages 4–6 are never wired into `runPipeline`.** The real entry point stops at Stage 3. `runStage4/5/6` are called only by their own tests. The pipeline cannot build, QA, or deploy an app end-to-end. `run.ts` / `runPipelineWithStages`.

**🔴 F2 — Stage 6 live-retest is a permanent no-op.** `runLiveRetestStub` always returns `pass:true`; the real `runStage5` (which now exists) was never swapped in, despite the stub comment promising that swap. The design's signature deploy-time QA does nothing. `stage6-deployment.ts`.

**🟡 F3 — Navya and Deepika are inert stubs wired into a live gate.** Both still hardcode `score = 100`, `findings: []`, with `// TODO Phase 1`. Stage 5's `navyaResult.passed && deepikaResult.passed` is therefore always true — the entire severity-weighted (logic + performance) arm of Stage 5 is a no-op; only Karan does real work. Pre-existing (not modified by this branch), but the branch builds Stage 5 on top of them without flagging that two of its three adversarial agents don't function. Violates the spirit of "no placeholders that hide missing behavior." `agents/qa/navya`, `agents/qa/deepika`.

**🟡 F4 — Checkpoint keys drift / missing for 4–6.** Stage 3 written under two keys (`03-ui-preview` in run.ts, `03-design-lock` in the stage file); Stages 4–6 write no checkpoints. Crash-resume beyond Stage 3 is impossible even after F1 is fixed. `run.ts`, `stage3-ui-preview.ts`, stages 4–6.

**🟡 F5 — Path-traversal guard not applied to `projectId` in stage4 keypair + tier3 screenshot paths.** Inconsistent with checkpoint.ts/gateway.ts. Low reachability today, but a cheap, known-pattern fix. `stage4-multi-agent-dev.ts:88`, `tier3-review.ts:46-47`.

**🟡 F6 — Typecheck not clean; new tool cases extend the `loop.ts` type error.** No green `tsc` gate on the branch; the two added tool `case`s (`web_search`, `screenshot`) participate in the pre-existing `ToolResult`-not-assignable-to-`Record<string,unknown>` errors. Runtime-safe under Bun, but the "every deterministic module has real coverage" bar coexists with a monorepo that doesn't typecheck. `packages/agent-runtime/src/loop.ts`.

**🟢 F7 — Mandatory stress-test verification not evidenced.** The design and plan both require 3 incremental stress-test app runs (after Stages 4, 5, 6) as non-optional self-verification, with results in PROGRESS.md. No such evidence exists; PROGRESS.md wasn't updated. These runs are the only thing that would have surfaced F1/F2. (Directly downstream of F1 — they can't be run until wiring exists.)

**🟢 F8 — `faultAgent` misattribution for logic/perf-only failures.** Always defaults to `"shubham"`. Honestly commented; fix requires Navya/Deepika to emit file paths. Tracks with F3.

**🟢 F9 — Design doc's "Stage 2: nothing to roll back" is now false.** Arjun's decomposition + sprint-contract file writes happen in Stage 1, before the gate. Doc text should be reconciled (a doc edit, per the design's own follow-up list).

**💡 F10 — `dag` parameter to `runStage4` is decorative** (`void dag`); ordering is hardcoded from Arjun's `independenceVerified`. Fine for now, but the DAG "drives" nothing at runtime — the patent-aligned DAG decomposition is built and cycle-checked in Stage 1 but not consumed for scheduling.

**💡 F11 — Stage 3 rethrows LLM-produced `result.errors` into a thrown error.** Non-hardcoded, but untrusted model text on a potentially user-facing error path. Scrub if it can reach a user.

---

## Recommendation

**NEEDS_FIXES.** The deterministic infrastructure (checkpointing, flags, DAG, hash-chain verification, gateway, zero-tolerance security scoring, path guards where present) is genuinely solid, real-TDD'd, and 70/70 green. But this is the *final* gate for a branch whose stated goal is an end-to-end 6-stage pipeline, and as integrated it does not run past Stage 3, its Stage 6 QA is a no-op, and two of three Stage-5 adversarial agents are inert. Those are integration-level defects invisible to per-task review, and they defeat the branch's core purpose.

Must-fix before this branch is done:

1. **F1** — Wire Stages 4, 5, 6 into the real entry point. Extend `runPipelineWithStages` (or add a `runFullPipeline`) to sequence Stage 3-lock → `runStage4(projectId, plan, dag)` → `runStage5(projectId, stage4Result)` → `runStage6(projectId, stage4Result)`, checkpointing `04-dev`/`05-qa`/`06-deployment` between each. Handle Stage 5 fail → fault-isolated re-fix → full retest per design.
2. **F2** — Replace `runLiveRetestStub` with a real dynamic import of `runStage5` against the live URL, and delete the stub. (Now unblocked — Stage 5 exists.)
3. **F3** — Either implement real parsing in Navya/Deepika (mirror Karan's Task-9/12 `parseSecurityFindings` + real scoring) or, at minimum, make Stage 5 fail loudly rather than silently pass when its logic/perf agents are known-stubbed. A Stage 5 that always passes two of three tiers is not the adversarial gate the design claims.
4. **F4** — Single, consistent checkpoint key per stage (drop `03-design-lock` or fold it into `03-ui-preview`); add checkpoints for Stages 4–6 as part of the F1 wiring.
5. **F5** — Apply the existing `assertValidIdentifier(projectId)` guard in `getProjectKeyPair` and `runTier3Review` before building paths.
6. **F6** — Fix the `loop.ts` `ToolResult` index-signature error (root cause: `let result: Record<string, unknown>`), so the branch typechecks; then run the F7 stress tests and record results in PROGRESS.md.

Should-fix / doc: F7 (run the mandatory stress tests once F1 lands), F9 (reconcile the design doc's Stage 2 rollback text). F8/F10/F11 acceptable to defer with the honest comments already in place.

Confidentiality and repo hygiene are both clean — no agent-name leak to any user-facing surface, and the stash/working tree show no residue of the earlier tooling incident.
