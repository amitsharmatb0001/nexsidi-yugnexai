# Task 4 Implementer Report

Status: DONE

## What I did

Implemented the DAG (Directed Acyclic Graph) task graph builder with cycle detection:

1. **dag.test.ts**: Wrote 6 comprehensive test cases covering:
   - Valid acyclic graphs (single chain and complex multi-dependency)
   - Circular dependency detection (simple 2-node cycle, self-referential cycle)
   - Dangling reference detection (missing dependency IDs)

2. **dag.ts**: Implemented the builder with two validation passes:
   - **Pass 1 (Dangling Reference Check)**: Before any cycle detection, validate that every `dependsOn` ID exists in the task set. Throws `DanglingReferenceError` with clear message listing missing dependencies.
   - **Pass 2 (Cycle Detection)**: DFS-based cycle detection using visiting/visited sets. Throws `CycleDetectedError` with the cycle path.

## Dangling-reference judgment call

**Decision: THROW on dangling references (not silent-ignore)**

**Reasoning:** The original sample code silently proceeds when `byId.get(id)` returns `undefined` for a dependency that doesn't exist in the task set. This is a critical gap because:

1. **Contract violation**: If task A depends on "missing-task", the dependency is not actually satisfied—the graph is incomplete and unexecutable.
2. **Silent failure risk**: A developer could add a task that references a typo'd dependency ID (e.g., `dependsOn: ["databasse-schema"]` instead of `"db-schema"`), and the system would silently treat it as having no dependencies, leading to execution order bugs and hard-to-debug race conditions.
3. **Clear failure mode**: Throwing `DanglingReferenceError` immediately tells the pipeline that the task graph is malformed and requires fixing, preventing downstream issues.

The implementation adds a dedicated validation pass before cycle detection to check all `dependsOn` references exist, throwing `DanglingReferenceError` with the task ID and list of missing dependency IDs.

## Test output

```
bun test v1.3.14 (0d9b296a)

 6 pass
 0 fail
 6 expect() calls
Ran 6 tests across 1 file. [54.00ms]
```

All tests pass:
- ✓ buildDag accepts a valid acyclic graph
- ✓ buildDag throws CycleDetectedError on a circular dependency
- ✓ buildDag throws DanglingReferenceError when dependsOn references non-existent task
- ✓ buildDag handles multiple dangling references with clear error message
- ✓ buildDag accepts complex valid DAG with multiple dependencies
- ✓ buildDag detects self-referential cycle

## Commit

```
94c5889 feat: add DAG task graph builder with cycle detection
```

Files:
- `pipeline/orchestrator/dag.ts` (41 lines)
- `pipeline/orchestrator/dag.test.ts` (59 lines)

## Concerns

None. The implementation is straightforward, well-tested, and handles the critical edge case of dangling references explicitly rather than silently ignoring them.
