# Task 10 Implementer Report

Status: DONE_WITH_CONCERNS

## What I did

Created the three Stage 1-3 wrapper files and the orchestrator entry point,
adapted to the CURRENT interfaces (not the plan's original code sample, which
predates the async-gateway and spec/plan-parameter changes noted in the task
brief):

- `pipeline/orchestrator/stages/stage1-requirements.ts`
  - `runStage1(projectId, userInput): Promise<{ spec: ProjectSpec; dag: Dag }>`
  - Calls Saanvi's real entry point, `run(projectId: string, userRequest: string): Promise<ProjectSpec>`
    (`agents/saanvi/src/index.ts`). Saanvi's real output is well-defined (a
    locked `ProjectSpec` with `features`, `apiEndpoints`, `dbTables`,
    `successCriteria`, a lock timestamp, and a `specHash`), so I used that
    type directly instead of `unknown`.
  - Saanvi does **not** produce a task breakdown/dependency graph — there is
    nothing in `ProjectSpec` resembling task IDs or dependencies. Per the
    brief, I built a minimal single-task DAG (`{ id: "requirements",
    dependsOn: [] }`) via `buildDag` purely so downstream code has a valid
    `Dag` shape. This is a placeholder, not real decomposition — real task
    decomposition is Arjun's job (`agents/arjun/src/index.ts`), which no
    stage in this pipeline invokes yet (see Concerns).

- `pipeline/orchestrator/stages/stage2-gateway.ts`
  - `runStage2(projectId, spec): Promise<GatewayDecision>`
  - Calls `resolveFlags()` (hook point only — no OTP/payment branching exists
    yet, matches "not built" note in the brief), derives a short human
    readable summary from the spec (`name`, `description`, feature count),
    calls `writeGatewayRequest(projectId, "02-gateway", summary)`, then polls
    `readGatewayDecision` (which I correctly `await`, since it's now async)
    every 2s until non-null, capped at a 30-minute timeout that throws a
    clear error on expiry.

- `pipeline/orchestrator/stages/stage3-ui-preview.ts`
  - `runStage3(projectId, plan): Promise<{ locked: boolean; outputDir: string }>`
  - Calls Aanya's real `run(plan as BuildPlan, "preview")`. On success, writes
    a `03-design-lock` checkpoint, then runs the same
    `writeGatewayRequest`/`readGatewayDecision` poll pattern as Stage 2 under
    stage id `"03-ui-preview"`, capped at the same 30-minute timeout.
  - Return value reflects the actual decision: `locked: decision.decision ===
    "proceed"`. I chose this over always returning `locked: true` (or
    throwing on "review") because `locked` is typed as `boolean` — if it
    could only ever be `true`, it would be typed as a literal. Mirroring
    Stage 2's contract (where "review" is a valid, non-error outcome handled
    by the caller) seemed the more consistent design. Noted as an adaptation
    below.

- `pipeline/orchestrator/run.ts` (did not exist yet — no earlier draft to
  adapt, confirmed via `ls` before writing)
  - `PipelineStages` interface + `runPipelineWithStages(projectId, userInput,
    stages): Promise<void>` — the injectable version, matching the CURRENT
    stage signatures (spec/plan params), not the plan's original 2-arg
    sample which predates those signature changes.
  - `runPipeline(projectId, userInput): Promise<void>` — loads the three real
    stage modules via `Promise.all` of dynamic `import()`s and wires them
    through `runPipelineWithStages`. Dynamic import keeps `run.ts` (and
    anything that imports it, like the test file) free of a transitive
    module-load-time dependency on Saanvi/Aanya's real agent code, which
    calls live LLMs.
  - Checkpoints after each stage: `01-requirements` (stage1's full result),
    `02-gateway` (the decision), `03-ui-preview` (stage3's result) —
    `03-ui-preview` checkpoint only gets written if Stage 2 decided
    "proceed", since the pipeline returns early otherwise.

## Interface adaptations from the plan

1. **`readGatewayDecision` is async** — the plan's original Task 10 sample
   didn't await it (it predates the async change). Both `stage2-gateway.ts`
   and `stage3-ui-preview.ts` `await` it correctly inside a polling loop with
   a 2s interval and a 30-minute timeout (the plan's original sample had no
   polling or timeout at all — it called the function once with no gate
   loop). This was an explicit requirement in the adapted brief, not
   something I invented.

2. **Stage 2/3 now take a `spec`/`plan` parameter** — the plan's original
   sample called `runStage2(projectId)` and `runStage3(projectId)` with no
   payload. The current brief's signatures (`runStage2(projectId, spec)`,
   `runStage3(projectId, plan)`) require passing data through. `run.ts`
   passes `stage1Result.spec` to both.

3. **No Arjun/BuildPlan stage exists anywhere in the pipeline yet** — this is
   the most significant gap, flagged prominently in code comments in
   `stage3-ui-preview.ts` and `run.ts`, and in Concerns below.

4. **Stage 1's return type uses the real `ProjectSpec`**, not `unknown`, per
   the brief's own guidance to prefer a well-defined type when one exists.

5. **`stage3`'s `locked` return value reflects the gate decision** rather than
   always being `true` — see explanation above.

## Test output

```
$ bun test pipeline/orchestrator/run.test.ts
bun test v1.3.14 (0d9b296a)

 3 pass
 0 fail
 9 expect() calls
Ran 3 tests across 1 file. [100.00ms]

$ bun test pipeline/orchestrator
bun test v1.3.14 (0d9b296a)

 23 pass
 0 fail
 30 expect() calls
Ran 23 tests across 5 files. [355.00ms]
```

Also ran an ad-hoc `tsc --noEmit` pass (using the same compiler options as
`tsconfig.base.json`/`tsconfig.bun.json`, since `pipeline/orchestrator/**` is
not currently included in any project's tsconfig `include` list — a
pre-existing gap, not introduced here) against the 4 new files plus their
full import graph. Zero errors originate from any of the 4 new files. The
only errors surfaced are pre-existing, unrelated to this task, and not
touched by it:
- `agents/generators/aanya/src/index.ts` and
  `agents/generators/shubham/src/index.ts` reference `plan.appName` /
  `plan.appDescription`, which do not exist on the `BuildPlan` interface
  (`agents/arjun/src/index.ts`). Pre-existing bug, unrelated to Task 10.
- Several `packages/agent-runtime/src/*.ts` errors (`ToolResult` not
  assignable to `Record<string, unknown>`, `spawnSync` argument typing).
  Pre-existing, unrelated to Task 10.

## Commit

c90d337 — feat: wire orchestrator entry point for Stages 1-3 with checkpointing

## Concerns

1. **No Arjun stage exists — Stage 3's real `plan` argument is not a real
   `BuildPlan`.** Aanya's real `run()` reads `plan.apiContract.baseUrl` and
   `plan.sharedTypes` unconditionally (not optional-chained) when building
   its agent prompt. `runPipeline()` currently passes Stage 1's `ProjectSpec`
   straight through as Stage 3's `plan` argument (the only artifact
   available), which lacks `apiContract`/`sharedTypes`/`dbSchema` entirely.
   **A real (non-stubbed) end-to-end `runPipeline()` call will throw a
   TypeError inside Aanya's `buildAgentTask`** (`Cannot read properties of
   undefined (reading 'baseUrl')`) until an Arjun stage (`agents/arjun/src`,
   `run(spec): Promise<BuildPlan>`) is wired in between Stage 1 and Stage 3.
   This is a real architectural gap in the plan as written — Arjun is never
   mentioned in Task 10, and no other task file in
   `docs/nexsidi/plans/2026-07-02-full-agentic-pipeline.md` wires Arjun into
   any stage either (confirmed via full-text search — zero matches for
   "Arjun" in the plan). Flagged here rather than silently working around it
   by inventing an ad-hoc BuildPlan-shaping step Arjun doesn't actually
   perform through a stage boundary.
2. **Stage 1's DAG is a placeholder** (single node, no dependencies) — noted
   explicitly in the brief as acceptable for now, but real task
   decomposition needs Arjun wired in (same gap as #1).
3. **`pipeline/orchestrator/**` is not part of any tsconfig's `include`
   list**, so `bun run typecheck` (the repo's root script) does not
   typecheck these files or any of the other existing orchestrator files
   (`checkpoint.ts`, `gateway.ts`, `dag.ts`, `flags.ts`, `types.ts`) either —
   this predates my change. I verified my 4 new files compile cleanly via an
   ad-hoc `tsc` invocation using the same compiler flags as
   `tsconfig.base.json`, but did not add `pipeline/orchestrator` to any
   tsconfig's `include`, since that's a pre-existing gap outside this task's
   file list.
4. **Discovered pre-existing bug (not fixed, out of scope):**
   `agents/generators/aanya/src/index.ts` (lines 203-204, 319-320) and
   `agents/generators/shubham/src/index.ts` (lines 102-103) reference
   `plan.appName` / `plan.appDescription`, neither of which exist on the
   `BuildPlan` interface (`agents/arjun/src/index.ts`). At runtime these
   evaluate to `undefined` and get interpolated into agent prompts as the
   literal string `"undefined"` rather than throwing (template literals
   don't throw on `undefined`), so this is a silent prompt-quality bug, not a
   crash. Left untouched since it's outside this task's file list — flagging
   for a separate fix.
