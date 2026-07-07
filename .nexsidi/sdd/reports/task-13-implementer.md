# Task 13 Implementer Report

Status: DONE_WITH_CONCERNS

## What I did

1. **Riya (`agents/riya/src/index.ts`)**
   - Added `resolveDeployTarget(target: "local" | "gcp"): { mode: "docker-compose" }`, throwing
     `"GCP deploy target not yet implemented — per design doc Open Follow-Up #5, build when Amit
     says it's needed"` on `"gcp"`, returning `{ mode: "docker-compose" }` on `"local"`.
   - Changed `run()`'s signature from `run(projectId: string)` to
     `run(projectId: string, deployTarget: "local" | "gcp" = "local")`, calling
     `resolveDeployTarget(deployTarget)` as the very first line — before `mkdirSync`, port
     finding, or the agent loop starts — so a `"gcp"` request fails immediately and loudly.
   - **Unplanned but necessary fix**: moved the `@nexsidi/db` / `drizzle-orm` imports from
     module-top-level to a dynamic `await import(...)` at the point of use (right before the DB
     write at the end of `run()`). `@nexsidi/db`'s client (`packages/db/src/client.ts`) throws
     `"DATABASE_URL is not set"` eagerly at import time. With a top-level import, merely importing
     `resolveDeployTarget` for a unit test pulled in the DB client and crashed before any test
     could run — `bun test agents/riya/` failed with "DATABASE_URL is not set" even for the pure,
     infra-free `resolveDeployTarget` tests. Deferring the import to point-of-use fixes this while
     leaving runtime behavior identical (the DB write still happens, just via a lazy import).

2. **`agents/riya/src/deploy-target.test.ts`** — created exactly as specified in the task brief
   (2 tests: local → docker-compose, gcp → throws).

3. **`pipeline/orchestrator/stages/stage6-deployment.ts`** — created:
   - `Stage6Result { success: boolean; appUrl: string; findings?: unknown; deliverySummary: DeliverySummary }`
   - `runStage6(projectId: string, stage4Result: Stage4Result, deps: Stage6Deps = defaultDeps): Promise<Stage6Result>`
     — calls `resolveFlags()` for `deployTarget`, passes it to the injected `deployFn` (real: Riya's
     `run`), fails fast (skips retest) if deploy didn't succeed, otherwise calls the injected
     `liveRetestFn` and folds both results into `Stage6Result`.
   - `buildDeliverySummary(deployResult, retest): DeliverySummary` — generic-labeled output
     (`status`, `appUrl`, `githubRepo` only — no scores, no iteration counts, no agent names),
     satisfying the plan's Confidentiality Global Constraint. `INTERNAL_AGENT_NAMES` is exported
     so the test can assert none of them ever appear in the serialized summary.
   - `Stage6Deps` injectable seam (`deployFn`, `liveRetestFn`) so the deterministic orchestration
     logic (flag plumbing, fail-fast behavior, summary shape) is unit-testable without live Docker
     or a live LLM call, per the plan's stated testing philosophy.

4. **`pipeline/orchestrator/stages/stage6-deployment.test.ts`** — 8 tests covering: deployTarget
   flows through from `resolveFlags()` (both `"gcp"` via env override and default `"local"`),
   fail-fast skips the retest on deploy failure, success path returns retest findings, a failing
   retest after a successful deploy is reported as `"failed"`, and two tests asserting
   `buildDeliverySummary` never leaks an internal agent name and only reports `"delivered"` when
   both deploy and retest pass.

## Riya's real interface and how you adapted

Riya's `run()` was already the real agentic version (`runAgent()` tool loop, `enableDockerTools`/
`enableHttpTools`, docker-compose write + health-check retry loop) — not a stub. It previously took
only `projectId`. I added `deployTarget` as a second parameter with a `"local"` default (matching
`FeatureFlags`'s documented default in `types.ts`/`flags.ts`) rather than making it required, so the
one other existing caller — `pipeline/activities/index.ts`'s legacy Temporal `runRiya(projectId)`
activity (the old Temporal-based pipeline the plan's Global Constraints explicitly supersede) —
keeps compiling and behaving exactly as before, with no forced migration. `resolveDeployTarget` is
called as literally the first statement in `run()`, ahead of `mkdirSync`/port allocation/the agent
loop, so `"gcp"` throws before any deploy side effect occurs.

## Stage 5 live-retest integration status

Task 12 (`pipeline/orchestrator/stages/stage5-adversarial-qa.ts`) has **not landed** — confirmed by
listing `pipeline/orchestrator/stages/`, which as of this task contains only
`stage1-requirements.ts`, `stage2-gateway.ts`, `stage3-ui-preview.ts`,
`stage4-multi-agent-dev.ts`(+`.test.ts`), and now `stage6-deployment.ts`(+`.test.ts`) — no
`stage5-*` file exists. Importing a `runStage5` would not resolve.

Per the brief's explicit fallback instruction, I did not block on this. `stage6-deployment.ts`
defines `runLiveRetestStub(projectId, appUrl)` — a clearly-marked, commented stub (see the
file-header comment and the function's own doc comment) that always returns `{ pass: true,
findings: [] }` and logs a `console.warn` naming exactly what's missing and what must replace it.
It's wired in via the `Stage6Deps.liveRetestFn` seam specifically so that once Task 12 lands a
live-URL-capable QA entry point, the fix is a one-line swap of `defaultDeps.liveRetestFn` for a
real `await import("./stage5-adversarial-qa.ts")` call — the same dynamic-import pattern
`stage4-multi-agent-dev.ts` already uses for its agent calls — with no change needed to
`runStage6`'s own logic or its tests (the tests already exercise both stub and real dependency
shapes via injection).

## Test output

```
$ bun test agents/riya/ pipeline/orchestrator/stages/
bun test v1.3.14 (0d9b296a)

 17 pass
 0 fail
 34 expect() calls
Ran 17 tests across 3 files. [321.00ms]
```

Breakdown: 2 tests in `agents/riya/src/deploy-target.test.ts` (both new, per spec), 7 pre-existing
tests in `pipeline/orchestrator/stages/stage4-multi-agent-dev.test.ts` (untouched, still green),
8 new tests in `pipeline/orchestrator/stages/stage6-deployment.test.ts`.

Typecheck: no dedicated tsconfig currently includes `pipeline/orchestrator/**` (checked
`pipeline/tsconfig.json` — it only includes `workflows`, `activities`, `worker.ts`, and
`../agents/**/*.ts`; this predates this task and affects every existing orchestrator/stage file,
not just this one). I verified there are no new type errors by building a temporary tsconfig
(extending `tsconfig.bun.json`, scoped to the relevant orchestrator/agent/package directories),
running `tsc --noEmit` against it, and deleting it afterward (never committed). The only errors
surfaced are pre-existing and unrelated to this task: `packages/agent-runtime/src/loop.ts` /
`tools/command.ts` (ToolResult/spawnSync typing issues that predate this task — confirmed via
`git stash` against the same tsc invocation) and `pipeline/orchestrator/run.test.ts` (pre-existing
`toBeNull()`-on-non-null-typed-value complaints, also predates this task). Nothing in
`agents/riya/src/index.ts`, `deploy-target.test.ts`, `stage6-deployment.ts`, or
`stage6-deployment.test.ts` produced a type error.

## Commit

`f4d732533b8b67d6f8cf878bcbd34e03cec487aa` — "feat: add deployTarget flag to Riya, GCP path
explicit not-yet-implemented"

Files: `agents/riya/src/index.ts` (modified), `agents/riya/src/deploy-target.test.ts` (new),
`pipeline/orchestrator/stages/stage6-deployment.ts` (new),
`pipeline/orchestrator/stages/stage6-deployment.test.ts` (new).

## Concerns

1. **Stage 5 live-retest is a stub, not real.** This is the single biggest gap relative to the
   design doc's intent for Stage 6 — the whole point of the live retest is catching deploy-config
   drift (CORS mismatches, unmounted routes) that only surfaces once containers are actually
   running. Right now `runStage6` will always report `success: true` from the retest step
   regardless of what's actually live, as long as Riya's deploy itself succeeded. This MUST be
   swapped for a real call once Task 12 lands `stage5-adversarial-qa.ts` with a live-URL-capable
   entry point. I deliberately made the swap point a single injected dependency
   (`Stage6Deps.liveRetestFn`) to make that follow-up small.
2. **`resolveFlags()` re-reads env vars per call, no caching.** Fine for now (matches how Stage 2
   already calls `resolveFlags()` with no caching), just noting it's the same pattern Stage 6
   inherited rather than something new I designed.
3. **Riya's dynamic-import-for-DB fix was outside the literal task brief** but was necessary to
   make `bun test agents/riya/` pass at all without a live `DATABASE_URL`/Postgres connection —
   the task explicitly required passing tests, and the pre-existing top-level DB import made even
   the trivial `resolveDeployTarget` tests fail on import. This is a real, load-bearing behavior
   change to note in review: the DB write in `run()` now happens via a lazily-resolved import
   rather than a top-level one. Runtime behavior is unchanged (same write, same timing relative to
   the rest of `run()`), only the import timing moved.
4. **`pipeline/activities/index.ts` (legacy Temporal pipeline) was left untouched.** Its
   `runRiya(projectId)` activity still calls `runRiyaAgent(projectId)` with one argument, which
   now implicitly deploys `"local"` via the new default parameter — same behavior as before my
   change (it never had a GCP concept), so this is not a regression, but it does mean that legacy
   code path will silently never exercise the new GCP-guard unless someone later updates it to
   pass a real flag. Flagging for awareness, not fixing — out of scope per the plan's "no Temporal
   in this plan" constraint, and that file is superseded by `pipeline/orchestrator/`.
5. **No tsconfig currently includes `pipeline/orchestrator/**`** for `bun run typecheck` /
   `tsc --noEmit` at the package level — this predates this task (confirmed the same gap exists
   for `stage4-multi-agent-dev.ts` too) but is worth someone fixing in a follow-up task so CI
   typechecking actually covers the orchestrator directory.
