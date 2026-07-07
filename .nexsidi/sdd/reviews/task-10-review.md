# Task 10 Review

Verdict: APPROVED

## Interface verification

Independently confirmed by reading the real source (not the reports):

- **Saanvi** (`agents/saanvi/src/index.ts:54`): `export async function run(projectId: string, userRequest: string): Promise<ProjectSpec>`. `ProjectSpec` has non-optional `name: string` / `description: string`, both always defaulted (`String(raw.name ?? "Untitled")`, `String(raw.description ?? "")`) — never `undefined`. Matches `stage1-requirements.ts`'s `runSaanvi(projectId, userInput)` call exactly.
- **Arjun** (`agents/arjun/src/index.ts:61`): `export async function run(spec: ProjectSpec): Promise<BuildPlan>`. Matches `runArjun(spec)` in `stage1-requirements.ts`. `BuildPlan.shubhamTasks/aanyaTasks/pranavTasks` are `GeneratorTask[]` with only `{ description, outputFiles }` — no `id`/`dependsOn` — confirming the report's claim that there's no real per-task dependency data to build DAG edges from.
- **Aanya** (`agents/generators/aanya/src/index.ts:23`): `export async function run(plan: BuildPlan, mode: "preview" | "integrate"): Promise<GeneratorResult>`. Matches `runAanya(plan as BuildPlan, "preview")` in `stage3-ui-preview.ts`. Confirmed the pre-fix crash claim is real: `buildAgentTask` (line 189) does `plan.apiContract.baseUrl ?? "..."` — non-optional access on `plan.apiContract` itself. If `plan` were still a bare `ProjectSpec` (no `apiContract` field), this throws `Cannot read properties of undefined (reading 'baseUrl')`. The fix's routing of the real `BuildPlan` here is what prevents that.
- `GeneratorResult` (`agents/generators/shubham/src/index.ts:10`) has `success: boolean`, `outputDir: string`, `errors: string[]` — matches `stage3-ui-preview.ts`'s `result.success` / `result.errors.join("; ")` / `result.outputDir` usage exactly.

All four call sites are correctly typed against the real, current agent interfaces.

## Test verification

Ran it myself:
```
$ bun test pipeline/orchestrator/
23 pass, 0 fail, 30 expect() calls, 5 files
```
Also ran `agents/generators/aanya/src/index.test.ts` (2 pass) since it's adjacent to this change.

Read `run.test.ts` in full (101 lines, 3 tests, all using injected stage stubs per the plan's stated testing approach — no real LLM calls):
1. "checkpoints after each stage and stops at an unapproved gateway" — asserts the call sequence stops at `stage2`, and that the `03-ui-preview` checkpoint is `null` when the gate returns `"review"`. Real gate-blocking logic, not a smoke test.
2. "lets stage3 run when stage2 decides proceed" — the positive-path complement, asserts `stage3` runs and its checkpoint is written.
3. "passes stage1's spec to stage2 and stage1's plan to stage3" — directly exercises the Arjun-fix's routing decision: asserts Stage 2 receives `{ name: "spec-from-stage1" }` and Stage 3 receives `{ appName: "plan-from-stage1" }` as two distinct objects. This is the one test that specifically locks in the same-cycle fix's behavior, not just infrastructure plumbing.

These are meaningful — they test real orchestration branching (sequencing, gate blocking, argument routing), consistent with the plan's stated approach of stub-testing orchestration logic while verifying agent-prompt behavior via stress tests instead of unit tests.

## Confidentiality check

Read the actual summary-string construction:
- `stage2-gateway.ts`'s `summarizeSpec()` builds `` `${name} — ${description} (${featureCount} feature(s))` `` from `spec.name`/`spec.description`/`spec.features.length` — these are the **project's** name/description (LLM-generated from the user's own request, e.g. "TaskFlow — a task manager..."), not an agent name.
- `stage3-ui-preview.ts`'s gateway summary is `` `UI preview ready for review at ${result.outputDir}` ``. `outputDir` comes from `getOutputDir()` in `agents/generators/aanya/src/index.ts:11` — `join(BUILD_DIR, projectId, "frontend")` — contains no agent name.

No internal agent name (Saanvi/Arjun/Aanya/etc.) appears in either gateway summary string. Confirmed clean.

Minor, non-blocking observation: `stage1-requirements.ts`'s `taskGroupToDagTasks()` builds DAG task IDs like `"shubham-0"`, `"aanya-1"`, `"pranav-2"` — these do embed agent names, but they're only ever written to internal checkpoint files (`01-requirements.json`) in this task's code paths, never into a `writeGatewayRequest` summary or any other status string. Not a violation today, but worth keeping in mind if a future stage (e.g. a Stage 4 progress UI) ever surfaces DAG task IDs directly to the user.

## Poll-loop soundness

Both `stage2-gateway.ts` and `stage3-ui-preview.ts` implement the same pattern: `while (Date.now() < deadline) { const decision = await readGatewayDecision(...); if (decision !== null) return decision/...; await sleep(2000); }` followed by `throw new Error(...)` after the 30-minute deadline.

- **Async correctness**: `readGatewayDecision` (`gateway.ts:59`) is `async` and returns `Promise<GatewayDecision | null>`. Both poll loops correctly `await` it before checking `!== null`. No missing-await bug.
- **Timeout handling**: on expiry, both throw a plain `Error` with a descriptive message (stage id, projectId, timeout duration) — this is a normal promise rejection propagating up through `runPipelineWithStages`'s `await stages.stage2(...)` / `await stages.stage3(...)`, not a crash. Fully catchable by whatever calls `runPipeline()`.
- **Corrupt-JSON handling**: `readGatewayDecision` retries up to 3 times (50ms apart) on `JSON.parse` failure before throwing `Gateway decision corrupt: ...` — a sensible defensive backstop against a non-atomic external writer, documented as such in a code comment. This also propagates as a normal rejection, not a crash.

Sound.

## Arjun fix design assessment

**appName/appDescription source**: Correct. `ProjectSpec.name`/`.description` (`agents/saanvi/src/index.ts:41-42`) are non-optional `string` fields, always populated with a fallback (`"Untitled"` / `""`) even if the LLM omits them. There is no path where `spec.name`/`spec.description` is missing, so copying them into `BuildPlan.appName`/`appDescription` in `agents/arjun/src/index.ts:80-81` is type-safe and behaviorally correct — not a latent `undefined` risk.

**Spec-vs-plan routing — real design gap, not just a hypothetical one.** I checked this against `docs/superpowers/specs/2026-07-01-full-agentic-pipeline-design.md`, the approved design doc this plan implements. Two things there are directly relevant:

1. `STAGE_1_REQUIREMENTS → Saanvi: spec doc + DAG task graph` — the design specifies Stage 1 as **Saanvi alone**, producing the DAG itself. Arjun is never mentioned anywhere in that document (confirmed via full-text search — zero matches, same as the implementer's search of the task-plan doc). The fix's approach of building the DAG from Arjun's `shubhamTasks`/`aanyaTasks`/`pranavTasks` is a reasonable improvise given that Saanvi's real `ProjectSpec` has no task-graph data at all (verified above) — but it does mean Stage 1 now does something architecturally different from what was approved: it runs a second real LLM-calling agent that the design doc placed nowhere in the stage sequence.
2. `## Stage 2 — Gateway ... On Review: spec returns to Stage 1 with feedback; **no agent work has started, nothing to roll back**.` This is now false as implemented. `runStage1` calls `runArjun(spec)` unconditionally, which calls the LLM **and writes `build-plan.json`/`shared-types.ts`/`api-contract.json`/`db-schema.json` to disk** (`agents/arjun/src/index.ts:97`, `writePlanFiles`) — all before Stage 2's gate ever runs. If the user clicks "Review" (reject) at Stage 2, Arjun's real work has already happened and already has side effects on disk. This isn't a crash or data-corruption risk (the files just get overwritten on the next Stage 1 run), but it directly contradicts the design doc's explicit invariant, and it means real LLM cost is spent on every Stage 2 rejection even though the human hasn't approved the spec yet.

There's a second-order consequence worth naming precisely, because the fix-implementer's own "Concerns" note slightly understates it: their report says the gate is approved "before Arjun's task decomposition/API contract details exist yet" — but that's not quite right. By the time Stage 2's gate runs, Arjun's `BuildPlan` **already exists** (Stage 1 runs Saanvi then Arjun sequentially, both complete before Stage 1 returns). The real gap isn't timing, it's that **no gate ever reviews Arjun's output at all** — the human approves the feature-level spec at Stage 2, and a materially more detailed technical decomposition (API contract, DB schema, exact task list) that was already generated from that same spec silently flows straight into Stage 3's real UI build with no review checkpoint of its own.

This is a genuine architecture-level gap between the approved design doc and this implementation, not a nitpick. It's reasonable that Task 10 doesn't solve it — the task's file list is `stage1-requirements.ts`/`stage2-gateway.ts`/`stage3-ui-preview.ts`/`run.ts`, and the alternative (not wiring Arjun in at all) leaves an actual crash, which is strictly worse. But it should be tracked as a follow-up decision: either (a) accept that Arjun's plan generation is unconditional pre-gate work and document that the design doc's "no agent work has started" line is superseded, or (b) move Arjun's invocation to after Stage 2's Proceed decision (its own stage or the start of Stage 3), which would restore the design's invariant at the cost of Stage 3 taking longer per DAG-task-graph-first, spec-then-plan structure.

## Regression check

Grepped every `BuildPlan` reference in the repo (8 files). The two new required fields (`appName`, `appDescription`) only needed to be added at Arjun's own construction site (`agents/arjun/src/index.ts:78-94`, direct object literal). Every other consumer either:
- reads fields off an existing `BuildPlan` (`agents/generators/{aanya,shubham,pranav}/src/index.ts`) — no construction, unaffected;
- constructs via `{ ...plan, ... }` spread (`pipeline/activities/index.ts:350`, `runCodeFix`'s `patchedPlan`) — inherits `appName`/`appDescription` automatically from the spread, no missing-property error.

Verified with `tsc --noEmit` directly (not just trusting the reports):
- `bunx tsc --noEmit -p agents/arjun/tsconfig.json` → 0 errors.
- `bunx tsc --noEmit -p agents/generators/aanya/tsconfig.json` and `.../shubham/tsconfig.json` → only pre-existing `packages/agent-runtime` errors (`ToolResult`/`Record<string,unknown>`, `spawnSync` typing) — no `appName`/`appDescription` errors.
- `bunx tsc --noEmit -p pipeline/tsconfig.json` → same pre-existing errors plus one pre-existing `agents/tilotma/src/orchestrator.ts` error — nothing new, nothing touching `BuildPlan`.

This matches the fix-implementer's reported diff exactly. No `BuildPlan` consumer was broken by adding the two fields.

Separately confirmed (not a regression, pre-existing and disclosed): `pipeline/orchestrator/` is not in any tsconfig's `include` list (`pipeline/tsconfig.json` only includes `workflows`, `activities`, `worker.ts`, `../agents/**/*.ts`) — so none of `checkpoint.ts`/`gateway.ts`/`dag.ts`/`flags.ts`/`run.ts`/`stages/*.ts` get typechecked by any repo script today. True before this task, not introduced by it, but worth a follow-up since it means a future silent type error in the orchestrator wouldn't be caught by `bun run typecheck`.

## Findings

1. **(Real, non-blocking) Arjun-in-Stage-1 violates the approved design doc's Stage 2 invariant** — see "Arjun fix design assessment" above. Recommend a tracked follow-up decision (not a Task 10 blocker): either accept and document that Arjun's plan generation now happens unconditionally pre-gate, or move it to after the Stage 2 Proceed decision.
2. **(Real, non-blocking) No review gate exists for Arjun's `BuildPlan` output anywhere in the pipeline.** The human reviews the spec (Stage 2) and the UI preview (Stage 3), but never the API contract / DB schema / task decomposition that Arjun produces in between — it flows straight through. Same follow-up as #1 would likely need to address this too.
3. **(Pre-existing, disclosed, non-blocking) `pipeline/orchestrator/` isn't in any tsconfig `include`.** Confirmed independently, not introduced by this task.
4. No other issues found. Interfaces match, tests are real and pass, no confidentiality leak, poll loop is sound, appName/appDescription population is type-safe and correct, no regressions in any other `BuildPlan` consumer.

## Recommendation

APPROVE Task 10 as implemented. The same-cycle Arjun fix correctly resolves the runtime crash it identified, is type-safe, doesn't regress any other `BuildPlan` consumer, and was honestly disclosed rather than hidden. The one substantive issue — Arjun's plan generation now happening unconditionally before the Stage 2 human gate, contradicting the approved design doc's "no agent work has started" invariant and leaving Arjun's output unreviewed by any gate — is real and should be turned into an explicit follow-up task/decision before Stage 4+ is built on top of this sequencing, but it is a pre-existing architectural question surfaced by this fix, not something Task 10's stated scope obligated the implementer to solve.
