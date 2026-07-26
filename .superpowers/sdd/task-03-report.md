# Task 03 Report — Workspace Service, Ownership, and Idempotent Turns

## Status

Implemented and committed as `e62cff8` (`feat(api): add owned idempotent workspace service`).

## Files

- `apps/api/src/workspaces/store.ts`
- `apps/api/src/workspaces/memory-store.ts`
- `apps/api/src/workspaces/postgres-store.ts`
- `apps/api/src/workspaces/service.ts`
- `apps/api/src/workspaces/service.test.ts`

This report is intentionally untracked and was not included in the task commit.

## RED

The two plan tests were written first. From `apps/api`, the focused command was:

```powershell
& 'C:\Users\amits\AppData\Roaming\npm\node_modules\bun\bin\bun.exe' test src/workspaces/service.test.ts
```

Observed result before implementation:

```text
Cannot find module './memory-store.ts'
0 pass, 1 fail, 1 error
```

The suite was then expanded to 26 deterministic tests before production code was created. After an offline frozen Bun install materialized the already-locked workspace symlinks (`315 installs across 399 packages (no changes)`), the expanded suite produced the same intended missing-module RED.

## GREEN

Fresh final focused verification from `apps/api`:

```text
bun test src/workspaces/service.test.ts
25 pass, 1 live-only skip, 0 fail
81 expect() calls, 26 tests, 1 file
```

Coverage includes:

- trimmed create/snapshot behavior and owner-obscured `workspace_not_found`;
- same-key/same-payload replay and different-content/client-ID `idempotency_conflict`;
- no duplicate turn/user/assistant messages;
- completed/failed turns, validation, and cross-workspace turn rejection;
- canonical draft version/hash creation and embedded-workspace rejection;
- exact selected-spec/hash approval, wrong-hash no-mutation behavior, prior approval supersession, atomic build-run creation/replay, changed approval-payload conflict, and cross-workspace spec rejection;
- event ownership, cursor resume behavior, and deny-by-shape public event output;
- offline source regression checks for Postgres transactions, row locking, composite workspace predicates, hash-before-mutation order, and conflict-aware insertion.

## Typecheck

A temporary config outside the repository, `C:\tmp\task03-tsconfig.json`, extended the API config while including only `apps/api/src/workspaces/**/*.ts`. Fresh command:

```text
bun x tsc -p C:\tmp\task03-tsconfig.json --pretty false
exit 0, no diagnostics
```

The required package-wide API typecheck was also attempted from `apps/api`:

```text
bun run typecheck
../../agents/generators/pranav/src/index.ts(112,35): error TS7006: Parameter 'c' implicitly has an 'any' type.
exit 1
```

That diagnostic is in an unrelated, pre-existing modified file. Per task scope it was not edited. No Task 3 file produced a diagnostic.

## Rolled-back PostgreSQL integration proof

Using only the existing local PostgreSQL 16 database at `localhost:5434`, the opt-in integration test ran inside an outer Drizzle transaction, deliberately threw `workspace_integration_rollback`, and verified no project fixture persisted afterward.

Fresh result:

```text
1 pass, 25 filtered out, 0 fail, 9 expect() calls
```

It proved live insert/replay and changed-payload conflict behavior, wrong-hash rejection before approval, exact approval, one approval-key replay, cross-owner rejection, and rollback cleanup.

## Commit and staged scope

Before commit, `git diff --cached --name-only` listed exactly the five workspace files above. `git diff --cached --check` exited 0, and there were no unstaged changes in `apps/api/src/workspaces`.

Commit:

```text
e62cff8 feat(api): add owned idempotent workspace service
5 files changed, 2059 insertions
```

All unrelated modified and untracked files remained unstaged.

## Concerns

- Package-wide API typecheck remains blocked by the unrelated Pranav `TS7006` diagnostic described above; the task-scoped TypeScript check is clean.
- The live proof exercises the real transactional service path and rollback cleanup, but deterministic concurrent unique-race branches are additionally guarded offline by source/contract tests rather than a multi-connection race fixture, which would not fit inside one rollback-only transaction.
