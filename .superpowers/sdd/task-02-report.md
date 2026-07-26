# Task 02 Report — Durable PostgreSQL Workspace Records

## Status

Completed in the original commit `4957978` (`feat(db): persist workspace planning and build state`) with review corrections in `f4ededb` (`fix(db): enforce workspace-scoped references`).

## RED

Command:

```powershell
& 'C:\Users\amits\AppData\Roaming\npm\node_modules\bun\bin\bun.exe' test packages/db/src/workspace-schema.test.ts
```

Observed before implementation:

```text
SyntaxError: Export named 'workspaceTurns' not found in module '...\packages\db\src\schema.ts'.
0 pass
1 fail
1 error
```

## GREEN

Fresh final verification:

```text
bun test packages/db/src/workspace-schema.test.ts
1 pass, 0 fail, 1 expect() call

bun run typecheck (from packages/db)
$ tsc --noEmit
exit 0
```

The SQL source was also compared directly with the approved Task 2 SQL block and matched exactly. All four package manifests parsed successfully and contained `@nexsidi/workspace-contract: workspace:*`.

## Migration Evidence

The repository root script `bun run db:migrate` printed Bun usage because its existing nested command uses `bun --cwd packages/db run migrate`, which is incompatible with the installed Bun 1.3 CLI ordering. No migration was applied by that wrapper invocation.

The existing migration runner was then invoked directly from `packages/db` against `postgres://nexsidi:nexsidi_dev@localhost:5434/nexsidi`:

```text
[migrate] 0000_initial.sql applied successfully
[migrate] 0001_custom_auth.sql applied successfully
[migrate] 0001_expand_project_id.sql applied successfully
[migrate] 0002_workspace_contract.sql applied successfully
```

A second direct run also exited 0 and reported `0002_workspace_contract.sql applied successfully`, verifying idempotency.

Read-only PostgreSQL catalog checks returned:

- 5 tables: `build_runs`, `workspace_events`, `workspace_messages`, `workspace_specs`, `workspace_turns`.
- 2 required indexes: `workspace_events_resume_idx` and partial unique `workspace_one_approved_spec`.
- 23 constraints covering the specified primary keys, checks, foreign keys, cascades, and unique constraints.
- `workspace_events.cursor`: `bigint` with `nextval('workspace_events_cursor_seq'::regclass)`.

## Files in Commit

- `packages/db/src/schema.ts`
- `packages/db/src/migrations/0002_workspace_contract.sql`
- `packages/db/src/workspace-schema.test.ts`
- `apps/api/package.json`
- `apps/web/package.json`
- `pipeline/package.json`
- `agents/planner/package.json`
- `bun.lock`

## Staged-Diff Audit

Before commit, `git diff --cached --name-only` listed exactly the eight files above. `git diff --cached --check` returned no errors. The lockfile diff contained only the planner workspace registration/dependency and workspace-contract package/consumer workspace entries; no external dependency versions or checksums changed. Other modified and untracked files remained unstaged.

## Concerns

- The existing root `db:migrate` wrapper needs a separate fix for Bun 1.3 CLI argument ordering; it was outside Task 2 scope.
- Docker Compose emitted its existing obsolete `version` warning; no Compose file was changed.
- The worktree PostgreSQL container was started during infrastructure inspection, while migration/query verification used the already-published `aiyug-postgres-1` database on port 5434.

## Review Correction — `f4ededb`

### Focused RED/GREEN

1. Ordinary unique-index metadata RED: expected `workspace_messages_workspace_id_client_message_id_key` in Drizzle `uniqueConstraints`, received `[]` (`1 pass, 1 fail`). After replacing the five ordinary `uniqueIndex(...)` builders with named `unique(...).on(...)` constraints: `2 pass, 0 fail`.
2. Same-workspace reference RED: the three parent `(workspace_id,id)` unique constraints were absent and child records exposed generated single-column FKs (`2 pass, 2 fail`). After adding three parent uniques and four named composite `foreignKey(...)` definitions: `4 pass, 0 fail`.
3. Migration RED: the original SQL lacked named constraints and any `DO $$` upgrade path (`8 pass, 2 fail`). After implementing fresh-database composite definitions and idempotent upgrade blocks: `10 pass, 0 fail`.

Fresh final offline verification:

```text
bun test packages/db/src/workspace-schema.test.ts
10 pass, 0 fail, 68 expect() calls

bun run typecheck (from packages/db)
$ tsc --noEmit
exit 0
```

The expanded test asserts exact tables and columns, SQL types, nullability, defaults, checks, named unique constraints, FK local/foreign column order and delete behavior, partial approved-spec index predicate, resume index order, fresh migration equivalence, safe upgrade patterns, and absence of destructive table/data statements.

### Direct SQL and Catalog Evidence

The exact `0002_workspace_contract.sql` file was piped directly to local PostgreSQL twice with `psql -v ON_ERROR_STOP=1`; both runs exited 0. Catalog verification returned:

- Eight named unique constraints with the required ordered columns.
- Four named same-workspace foreign keys:
  - turns `(workspace_id,user_message_id)` to messages `(workspace_id,id)`;
  - turns `(workspace_id,assistant_message_id)` to messages `(workspace_id,id)`;
  - runs `(workspace_id,spec_id)` to specs `(workspace_id,id)`;
  - events `(workspace_id,run_id)` to runs `(workspace_id,id)`.
- Zero obsolete single-column child FKs.
- The partial `workspace_one_approved_spec` and ordered `workspace_events_resume_idx` indexes remained exact.

A transaction inserted two workspaces and valid parent rows, then attempted all four cross-workspace child references. PostgreSQL rejected each with the corresponding composite FK. Nullable assistant/run inserts succeeded, and `ROLLBACK` removed every fixture; the post-check returned zero review project rows.

### Review Commit Audit

Before commit, the staged file list contained exactly:

- `packages/db/src/schema.ts`
- `packages/db/src/migrations/0002_workspace_contract.sql`
- `packages/db/src/workspace-schema.test.ts`

`git diff --cached --check` returned no errors. All unrelated modified and untracked files remained unstaged.

### Remaining Concern

The existing root `db:migrate` wrapper still has the previously reported Bun 1.3 CLI argument-order issue; review migration verification used the exact SQL directly and did not change the out-of-scope root script.

## Second Re-review Correction — `5b94816`

### Exact FK Names RED/GREEN

Live PostgreSQL preserved six historical `_fkey` names, while Drizzle metadata generated `..._projects_id_fk` and `..._users_id_fk` names. The focused RED expected `workspace_messages_workspace_id_fkey` but received `workspace_messages_workspace_id_projects_id_fk` (`10 pass, 1 fail`).

The five workspace/project references and `workspace_specs.approved_by` now use explicit named Drizzle `foreignKey(...)` callbacks. Metadata asserts exact names, local/foreign columns, project cascade actions, and approved-by no-action. Focused GREEN: `11 pass, 0 fail`.

### Exact Defaults and Full DDL RED/GREEN

The expanded default signature covers all 14 defaulted Drizzle columns:

- UUIDs render as `gen_random_uuid()`.
- Timestamps render as `now()`.
- Build status renders as `'queued'`.
- The event cursor is `bigserial`, primary, defaulted implicitly by its serial sequence.

The initial full-DDL RED showed inline unnamed project/user references instead of exact named table constraints, and no alternate-name upgrade paths (`12 pass, 2 fail`). The migration now has exact normalized CREATE TABLE contracts for every column type, length, nullability, default, check, FK, unique, and serial declaration. Its upgrade block renames known alternate Drizzle FK names when present, adds a missing preserved FK, or removes an alternate duplicate when the preserved FK already exists.

Fresh final verification:

```text
bun test packages/db/src/workspace-schema.test.ts
14 pass, 0 fail, 85 expect() calls

bun run typecheck (from packages/db)
$ tsc --noEmit
exit 0
```

### Direct Migration and Catalog Evidence

The exact `0002_workspace_contract.sql` file was applied directly to PostgreSQL twice with `psql -v ON_ERROR_STOP=1`; both runs exited 0. Catalog checks returned:

- Exactly six preserved FK names.
- Five workspace/project FKs with `ON DELETE CASCADE`.
- `workspace_specs_approved_by_fkey` with no cascade.
- Zero alternate Drizzle FK names.
- All 14 default/type rows exactly matched the expected catalog contract; `default_contract_mismatches = 0`.

### Commit Audit

Commit `5b94816` contains only:

- `packages/db/src/schema.ts`
- `packages/db/src/migrations/0002_workspace_contract.sql`
- `packages/db/src/workspace-schema.test.ts`

`git diff --cached --check` returned no errors before commit. Unrelated modified and untracked files remained unstaged.

### Concerns

None within this follow-up scope. The root migration wrapper and cursor API representation were explicitly left unchanged.
