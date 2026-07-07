# Task 8 Fix Report

Status: DONE

## What I did

Read `pipeline/activities/index.ts` around both call sites before editing:

- `runAanya()` (Stage 3b activity, real-backend generation path) at line 73
- `runCodeFix()` (QA-fix-iteration retry path) at line 358

Both call `agents/generators/aanya/src/index.ts`'s `run()`, whose signature is
now `run(plan: BuildPlan, mode: "preview" | "integrate"): Promise<GeneratorResult>`.
Neither call site is the future Stage-3-preview-only flow (that orchestrator
concept doesn't exist yet), so both got the `"integrate"` mode per the task
instructions.

### Call site 1 — `pipeline/activities/index.ts:73` (inside `runAanya`)

Before:
```ts
const result = await runAanyaAgent(getPlan(projectId));
```
After:
```ts
const result = await runAanyaAgent(getPlan(projectId), "integrate");
```

### Call site 2 — `pipeline/activities/index.ts:358` (inside `runCodeFix`)

Before:
```ts
await Promise.all([
  runShubhamAgent(patchedPlan),
  runAanyaAgent(patchedPlan),
]);
```
After:
```ts
await Promise.all([
  runShubhamAgent(patchedPlan),
  runAanyaAgent(patchedPlan, "integrate"),
]);
```

## Typecheck output

Ran `bunx tsc --noEmit` from the `pipeline/` directory (matches the
`typecheck` script in `pipeline/package.json`; CI's root `bun run typecheck`
fans this out per-workspace via `bun run --filter '*' typecheck`).

Full output after the fix (grepped for `TS2554` → 0 matches, confirming both
"Expected 2 arguments, but got 1" errors are gone):

```
../agents/generators/aanya/src/index.ts(203,17): error TS2339: Property 'appName' does not exist on type 'BuildPlan'.
../agents/generators/aanya/src/index.ts(204,21): error TS2339: Property 'appDescription' does not exist on type 'BuildPlan'.
../agents/generators/aanya/src/index.ts(319,18): error TS2339: Property 'appName' does not exist on type 'BuildPlan'.
../agents/generators/aanya/src/index.ts(320,24): error TS2339: Property 'appDescription' does not exist on type 'BuildPlan'.
../agents/generators/shubham/src/index.ts(102,17): error TS2339: Property 'appName' does not exist on type 'BuildPlan'.
../agents/generators/shubham/src/index.ts(103,21): error TS2339: Property 'appDescription' does not exist on type 'BuildPlan'.
../agents/tilotma/src/orchestrator.ts(45,41): error TS2345: Argument of type 'ModelId | undefined' is not assignable to parameter of type 'ModelId'.
  Type 'undefined' is not assignable to type 'ModelId'.
../packages/agent-runtime/src/loop.ts(136,11): error TS2322: Type 'ToolResult' is not assignable to type 'Record<string, unknown>'.
  Index signature for type 'string' is missing in type 'ToolResult'.
../packages/agent-runtime/src/loop.ts(140,11): error TS2322: Type 'ToolResult' is not assignable to type 'Record<string, unknown>'.
  Index signature for type 'string' is missing in type 'ToolResult'.
../packages/agent-runtime/src/loop.ts(144,11): error TS2322: Type 'ToolResult' is not assignable to type 'Record<string, unknown>'.
  Index signature for type 'string' is missing in type 'ToolResult'.
../packages/agent-runtime/src/loop.ts(148,11): error TS2322: Type 'ToolResult' is not assignable to type 'Record<string, unknown>'.
  Index signature for type 'string' is missing in type 'ToolResult'.
../packages/agent-runtime/src/loop.ts(152,11): error TS2322: Type 'ToolResult' is not assignable to type 'Record<string, unknown>'.
  Index signature for type 'string' is missing in type 'ToolResult'.
../packages/agent-runtime/src/loop.ts(156,11): error TS2322: Type 'ToolResult' is not assignable to type 'Record<string, unknown>'.
  Index signature for type 'string' is missing in type 'ToolResult'.
../packages/agent-runtime/src/loop.ts(160,11): error TS2322: Type 'ToolResult' is not assignable to type 'Record<string, unknown>'.
  Index signature for type 'string' is missing in type 'ToolResult'.
../packages/agent-runtime/src/loop.ts(164,11): error TS2322: Type 'ToolResult' is not assignable to type 'Record<string, unknown>'.
  Index signature for type 'string' is missing in type 'ToolResult'.
../packages/agent-runtime/src/tools/command.ts(24,29): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
  Type 'undefined' is not assignable to type 'string'.
../packages/agent-runtime/src/tools/command.ts(55,30): error TS2769: No overload matches this call.
  Overload 1 of 8, '(command: string, args: readonly string[], options: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string>', gave the following error.
    Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
      Type 'undefined' is not assignable to type 'string'.
  Overload 2 of 8, '(command: string, args: readonly string[], options: SpawnSyncOptionsWithBufferEncoding): SpawnSyncReturns<NonSharedBuffer>', gave the following error.
    Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
      Type 'undefined' is not assignable to type 'string'.
  Overload 3 of 8, '(command: string, args?: readonly string[] | undefined, options?: SpawnSyncOptions | undefined): SpawnSyncReturns<string | NonSharedBuffer>', gave the following error.
    Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
      Type 'undefined' is not assignable to type 'string'.
```

No new errors were introduced by the two-line change — this is the same
category of pre-existing noise (BuildPlan missing `appName`/`appDescription`,
`ModelId | undefined` in tilotma's orchestrator, `ToolResult` shape mismatch
and `spawnSync` arg typing in `packages/agent-runtime`), none of which touch
`pipeline/activities/index.ts` or the `run()` call sites.

## Commit

`1880afb` — "fix: pass explicit mode argument to Aanya's run() at existing call sites"

## Concerns (if any)

`pipeline/` has pre-existing, unrelated `tsc --noEmit` errors (11 distinct
errors across 4 files, listed above) that were present before this fix and
are out of scope for this task:

- `agents/generators/aanya/src/index.ts` and `agents/generators/shubham/src/index.ts`
  reference `plan.appName` / `plan.appDescription`, which don't exist on the
  `BuildPlan` type.
- `agents/tilotma/src/orchestrator.ts:45` passes a possibly-`undefined`
  `ModelId`.
- `packages/agent-runtime/src/loop.ts` has 8 `ToolResult` → `Record<string, unknown>`
  assignment errors.
- `packages/agent-runtime/src/tools/command.ts` has 2 `spawnSync` argument
  typing errors from possibly-`undefined` strings.

These were not introduced by this change and are unrelated to the `TS2554`
issue this task targeted — flagging per the task's instructions, not fixing.
