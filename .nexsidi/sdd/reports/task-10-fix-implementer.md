# Task 10 Fix Report

Status: DONE

## What I did

Confirmed Arjun's real interface by reading `agents/arjun/src/index.ts`:
`export async function run(spec: ProjectSpec): Promise<BuildPlan>` — matches
what the implementer reported. It calls the LLM, parses/defaults the result,
writes sprint-contract files to disk (D23), and returns a hash-stamped
`BuildPlan`.

Wired Arjun into the pipeline:

1. **`pipeline/orchestrator/stages/stage1-requirements.ts`** — now calls
   `runSaanvi` then `runArjun(spec)`, and returns
   `{ spec, plan, dag }` (previously `{ spec, dag }` with a synthetic
   single-task DAG).
2. **DAG construction** — `BuildPlan` does not include cross-task
   `dependsOn` edges (see below), so `buildDag()` cannot build a real
   dependency graph. Instead of stubbing a single fake "requirements" node, I
   now build one `DagTask` per real task Arjun produced
   (`shubhamTasks`/`aanyaTasks`/`pranavTasks`), each with `dependsOn: []` —
   which is accurate, not a placeholder: Arjun's `independenceVerified`
   contract guarantees these tasks don't depend on each other's in-progress
   files. `complexity` is derived from `outputFiles.length`. If Arjun ever
   starts emitting real dependency edges between tasks, that's the place to
   consume them. A fallback single-node DAG is kept only for the edge case
   where all three task arrays come back empty.
3. **`pipeline/orchestrator/run.ts`** — `Stage1Output` changed from
   `{ spec: unknown }` to `{ spec: unknown; plan: unknown }`.
   `runPipelineWithStages` now passes `stage1Result.spec` to Stage 2 (human
   approval-gate summary, which reads `spec.name`/`description`/`features` —
   fields `BuildPlan` does not carry) and `stage1Result.plan` to Stage 3
   (Aanya's generator, which requires the real `BuildPlan` shape). This is a
   deliberate judgment call: the task description said "have runStage1
   return the real BuildPlan... as the artifact that flows forward," but
   fully replacing `spec` with `plan` everywhere would have broken Stage 2's
   `summarizeSpec()` (it reads `ProjectSpec`-only fields with no `BuildPlan`
   equivalent, e.g. `features`). Returning *both* artifacts and routing each
   to the stage that actually needs it satisfies the intent (Stage 3 gets a
   real, correctly-typed `BuildPlan`) without a wider, out-of-scope edit to
   `stage2-gateway.ts`, which the task's own file list didn't include.
4. **`pipeline/orchestrator/stages/stage3-ui-preview.ts`** — no functional
   change needed to the `plan: unknown` parameter or the `plan as BuildPlan`
   cast (that cast is now accurate at runtime); only updated the stale
   "KNOWN GAP" header comment to describe the fix instead of the gap.
5. **`appName`/`appDescription` issue** — verified genuinely true: `BuildPlan`
   had no `appName`/`appDescription` fields, but
   `agents/generators/aanya/src/index.ts` (lines 203-204, 319-320) and
   `agents/generators/shubham/src/index.ts` (lines 102-103) both read
   `plan.appName ?? "..."` / `plan.appDescription ?? "..."`. Confirmed via
   `tsc --noEmit` on a stashed (pre-fix) tree — see Typecheck output below,
   this was a real `TS2339: Property 'appName' does not exist on type
   'BuildPlan'` error (x6), not just a silent-`undefined` runtime issue.
   Judgment call: added `appName: string` and `appDescription: string` to
   `BuildPlan` (`agents/arjun/src/index.ts`) and populated them in Arjun's
   `run()` directly from `spec.name` / `spec.description` — the same pattern
   already used for `projectId` (derived from the spec, not asked of the
   LLM). This was preferred over changing Aanya/Shubham to read some other
   existing field, because neither generator has any other field that
   carries a human-readable project name/description, and both prompt
   builders need one to give the LLM meaningful project context. No changes
   were needed to `agents/generators/aanya/src/index.ts` or
   `agents/generators/shubham/src/index.ts` themselves — their existing
   `plan.appName`/`plan.appDescription` reads are now valid against the
   updated `BuildPlan` type.
6. **`pipeline/orchestrator/run.test.ts`** — updated the three stage1 stubs
   to return `{ spec, plan }` instead of `{ spec }`, updated the
   corresponding checkpoint assertion, and renamed/adjusted the third test
   ("passes stage1's spec through to stage2 and stage3" ->
   "passes stage1's spec to stage2 and stage1's plan to stage3") to assert
   that Stage 2 receives `spec` and Stage 3 receives `plan` as two distinct
   objects, matching the new routing in `run.ts`. This is a pure type/shape
   alignment on injectable stubs, no new test logic.

## BuildPlan's real shape

```ts
export interface BuildPlan {
  projectId: string;
  appName: string;              // NEW — copied from ProjectSpec.name
  appDescription: string;       // NEW — copied from ProjectSpec.description
  sharedTypes: string;
  apiContract: { baseUrl: "http://localhost:3001"; endpoints: RestEndpoint[] };
  dbSchema: { tables: DrizzleTable[] };
  shubhamTasks: GeneratorTask[];   // { description: string; outputFiles: string[] }
  aanyaTasks: GeneratorTask[];
  pranavTasks: GeneratorTask[];
  independenceVerified: boolean;
  buildPlanHash: string;
}
```

Relevant to this fix: `GeneratorTask` has no `id` or `dependsOn` field — it's
just `{ description, outputFiles }`. There is no per-task dependency data in
`BuildPlan` at all; independence between the three agent's task lists is
asserted only at the whole-list level via `independenceVerified: boolean`.
That's why the DAG built in Stage 1 has one node per task with `dependsOn: []`
rather than a real edge-based graph — there's nothing in `BuildPlan` yet to
build edges from.

## Test output

```
$ bun test pipeline/orchestrator/
bun test v1.3.14 (0d9b296a)

 23 pass
 0 fail
 30 expect() calls
Ran 23 tests across 5 files. [302.00ms]
```

## Typecheck output

No repo-root tsconfig; used the package-level configs that cover the changed
files (`pipeline/tsconfig.json`, `agents/arjun/tsconfig.json`,
`agents/generators/aanya/tsconfig.json`, `agents/generators/shubham/tsconfig.json`).

After the fix (`bunx tsc --noEmit -p pipeline/tsconfig.json`):

```
agents/tilotma/src/orchestrator.ts(45,41): error TS2345: Argument of type 'ModelId | undefined' is not assignable to parameter of type 'ModelId'.
packages/agent-runtime/src/loop.ts(136,11): error TS2322: Type 'ToolResult' is not assignable to type 'Record<string, unknown>'. (x8, lines 136-164)
packages/agent-runtime/src/tools/command.ts(24,29): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
packages/agent-runtime/src/tools/command.ts(55,30): error TS2769: No overload matches this call. (3 overloads)
```

All of these are in files this task did not touch
(`agents/tilotma/src/orchestrator.ts`, `packages/agent-runtime/src/loop.ts`,
`packages/agent-runtime/src/tools/command.ts`) — pre-existing per the task
brief.

To confirm no regression and quantify what the fix actually resolved, I
diffed against the pre-fix tree (`git stash` then re-ran the same command):
the stashed (pre-fix) output contained everything above **plus** 6 additional
errors that are now gone:

```
agents/generators/aanya/src/index.ts(203,17): error TS2339: Property 'appName' does not exist on type 'BuildPlan'.
agents/generators/aanya/src/index.ts(204,21): error TS2339: Property 'appDescription' does not exist on type 'BuildPlan'.
agents/generators/aanya/src/index.ts(319,18): error TS2339: Property 'appName' does not exist on type 'BuildPlan'.
agents/generators/aanya/src/index.ts(320,24): error TS2339: Property 'appDescription' does not exist on type 'BuildPlan'.
agents/generators/shubham/src/index.ts(102,17): error TS2339: Property 'appName' does not exist on type 'BuildPlan'.
agents/generators/shubham/src/index.ts(103,21): error TS2339: Property 'appDescription' does not exist on type 'BuildPlan'.
```

`bunx tsc --noEmit -p agents/arjun/tsconfig.json` — 0 errors.
`bunx tsc --noEmit -p agents/generators/aanya/tsconfig.json` and
`agents/generators/shubham/tsconfig.json` — only the pre-existing
`agent-runtime` errors listed above, no `appName`/`appDescription` errors.

## Commit

(filled in after `git commit` — see repo log for
"fix: wire Arjun into Stage 1 to produce a real BuildPlan for Stage 3 (was silently stubbed, would crash at runtime)")

## Concerns

- Stage 2 (`stage2-gateway.ts`) still receives the raw `ProjectSpec`, not the
  `BuildPlan`. This is intentional (see "What I did" #3) but means a human
  reviewing at the Stage 2 gate approves the *spec* (features, endpoints,
  tables) before Arjun's task decomposition/API contract details exist yet.
  That was true before this fix too (Stage 2 never depended on Arjun's
  output) — not a regression, just noting it's still the case.
- The DAG built in Stage 1 has no real dependency edges between tasks (see
  "BuildPlan's real shape" above) because `BuildPlan`/`GeneratorTask` carry no
  such data today. If/when downstream orchestration needs real task-level
  ordering (e.g. for progress tracking or partial retries), either Arjun's
  output schema needs a `dependsOn` field per task, or that ordering needs to
  be inferred some other way. Flagging this as a follow-up gap, not fixing it
  here — it's the same "keep DAG-building minimal" allowance the task brief
  explicitly permitted.
- No repo-root `tsconfig.json`/typecheck script exists, so I typechecked via
  the package-level configs that actually cover the changed files. I did not
  attempt to typecheck every package in the monorepo (out of scope).
