# Task 4 Review

Verdict: APPROVED

## Spec compliance

Spec (Task 4, plan doc) requires: `buildDag(tasks: DagTask[]): Dag` and `class CycleDetectedError extends Error`, consuming `DagTask`/`Dag` from `./types.ts`.

- `buildDag(tasks: DagTask[]): Dag` — present, exact signature, imports `DagTask`/`Dag` from `./types.ts`. Matches.
- `CycleDetectedError extends Error` — present, constructor `(cyclePath: string[])` builds `Cycle detected in task graph: ${cyclePath.join(" -> ")}` — this is verbatim identical to the plan's own Step 3 sample code, not a reinterpretation.
- `types.ts` (`DagTask { id, description, complexity, dependsOn }`, `Dag { tasks }`) is unchanged from Task 1 and used identically here — no shape drift.
- `DanglingReferenceError` is an addition beyond the plan's literal Step-3 snippet, but it's additive (a new export, new class), doesn't change the `buildDag`/`CycleDetectedError` contract, and is exactly the kind of judgment call the task description says the implementer was asked to make. The implementer's own report (`.nexsidi/sdd/reports/task-4-implementer.md`) documents the reasoning: silent `byId.get(id)` returning `undefined` on a typo'd dependency ID would otherwise be treated as "no dependency" and silently corrupt execution order — a real silent-failure risk, correctly identified and fixed.
- Ran `bunx tsc --noEmit` against `dag.ts`/`types.ts` — the only errors are pre-existing bun-types ambient-declaration noise (`node:util`/`node:tls` globals), nothing attributable to these two files.

No placeholders, no TODOs. Matches Global Constraints.

## Test verification

Ran it myself:

```
$ bun test pipeline/orchestrator/dag.test.ts
bun test v1.3.14 (0d9b296a)

 6 pass
 0 fail
 6 expect() calls
Ran 6 tests across 1 file. [45.00ms]
```

6 tests, 6 pass — matches the implementer's report claim of 6 exactly (no inflation). Breakdown: valid chain, 2-node cycle, single dangling ref, multiple dangling refs, diamond-shaped valid DAG, self-referential cycle.

## Dangling-reference + cycle interaction check

The two validation passes are **not interleaved** — they're strictly sequential. Pass 1 (`for (const task of tasks) { ... }`, lines checking `missingDeps`) iterates and validates **every** task's `dependsOn` against `byId` and throws on the first dangling reference found, *before* pass 2 (the DFS cycle detector) ever runs. Pass 2 only executes if pass 1 completes without throwing, which means pass 2 can only ever run on a graph that is already known to have zero dangling references.

Consequence: it is structurally impossible for `CycleDetectedError` to fire while a dangling reference is present (pass 2 never starts in that case), and impossible for a dangling reference to somehow present as a `CycleDetectedError` — the two error types can never be swapped or mislabeled.

I verified this empirically rather than trusting the trace alone, with a throwaway probe test (`buildDag` imported directly, not committed to the repo):

**Case A — cycle and dangling ref on different tasks** (`a<->b` cycle, `c` has a dangling ref to `"missing"`):
```
Error type: DanglingReferenceError
Error message: Task "c" depends on non-existent tasks: missing
```
`DanglingReferenceError` surfaces. The `a<->b` cycle is real but is never reported in this call — pass 1 throws on task `c` before pass 2 (which would have found the cycle) ever starts.

**Case B — cycle and dangling ref on the SAME task** (`a` depends on `["b", "missing"]`, `b` depends on `["a"]` — so `a` is simultaneously part of a real cycle and has a typo'd dependency):
```
Error type (same-task case): DanglingReferenceError
Error message (same-task case): Task "a" depends on non-existent tasks: missing
```
Same outcome — dangling reference wins, cycle is invisible for this call.

**Case C — after removing the dangling ref, same cycle re-run:**
```
Error type (round 2, dangling fixed): CycleDetectedError
```
Once the dangling reference is fixed, the pre-existing cycle correctly surfaces on the next call.

**Conclusion on the specific question asked:** No, it can never produce a *wrong* error (e.g. reporting "cycle" for what's really a typo'd id, or vice versa) — the strict two-pass ordering guarantees `DanglingReferenceError` always has precedence and `CycleDetectedError` is only ever thrown against an already-reference-valid graph. The one real (non-blocking) UX consequence: if a task set has both problems, the developer sees them one at a time across two separate `buildDag` calls/fixes rather than both at once. That's a reasonable fail-fast design choice (comparable to a compiler reporting syntax errors before type errors), not a defect — worth a one-line comment in `dag.ts` if the author wants to preempt future "why didn't it also catch the cycle" questions, but not something I'm blocking on.

## Self-loop case

Traced `buildDag([{ id: "a", dependsOn: ["a"], ... }])` through `visit`:

1. Pass 1: `a`'s only dep is `"a"` itself, which *is* in `byId` (it's the task's own id) — not dangling, so pass 1 passes clean.
2. Pass 2: `visit("a", [])` → `visited` doesn't have `"a"`, `visiting` doesn't have `"a"` → `visiting.add("a")` (now `{a}`) → looks up task `a`, iterates its one dep `"a"` → recurses `visit("a", ["a"])` → this inner call checks `visited.has("a")` (still false, only added *after* the loop over deps completes) and `visiting.has("a")` (**true**, added in the outer/still-in-progress call) → throws `CycleDetectedError(["a", "a"])` → message `"Cycle detected in task graph: a -> a"`.

Correctly caught as a cycle via the `visiting` (gray/in-progress) set, not `visited` (black/done) — the self-edge is detected exactly because `visiting` is populated *before* recursing into children, so a task that depends on itself revisits itself while still gray. This is covered by the repo's own test (`"buildDag detects self-referential cycle"`), which I confirmed passes.

## Findings

None blocking.

Non-blocking observation (not a defect, just worth knowing): when a task set has both a dangling reference and an independent cycle, only the dangling reference is reported per `buildDag` call — the cycle isn't discoverable until the dangling reference is fixed and the function is called again. This is a natural consequence of the sequential two-pass design and doesn't produce incorrect output, but it's worth being aware of if this ever gets wired into an interactive "show the user everything wrong with their spec at once" UI later (Stage 1 in the pipeline plan) — at that point a "collect all pass-1 dangling errors, then all pass-2 cycle errors" batch-reporting mode might be worth adding. Not required for this task.

## Recommendation

Approve as-is. `buildDag`/`CycleDetectedError` match the Task 4 spec exactly; the added `DanglingReferenceError` is a correctly-reasoned, correctly-implemented answer to the silent-failure-risk judgment call the implementer was asked to make, with no interaction bugs against cycle detection (verified empirically, not just by reading). Self-loop and diamond-dependency cases are both handled correctly by the standard three-color (visiting/visited) DFS algorithm — no false positives, no false negatives. 6/6 tests pass as claimed.
