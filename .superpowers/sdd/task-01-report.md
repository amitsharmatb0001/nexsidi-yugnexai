# Task 01 Report: Shared Workspace Contract

## Status

DONE

## RED evidence

Command:

```powershell
& 'C:\Users\amits\AppData\Roaming\npm\node_modules\bun\bin\bun.exe' test packages/workspace-contract/src/spec.test.ts packages/workspace-contract/src/state-machine.test.ts packages/workspace-contract/src/public-events.test.ts
```

Result: exit 1; 0 passed, 3 failed, 3 errors. Each test file failed for the intended reason: its production module did not exist (`./spec.ts`, `./state-machine.ts`, and `./public-events.ts`).

## GREEN evidence

Tests:

```powershell
& 'C:\Users\amits\AppData\Roaming\npm\node_modules\bun\bin\bun.exe' test packages/workspace-contract/src/spec.test.ts packages/workspace-contract/src/state-machine.test.ts packages/workspace-contract/src/public-events.test.ts
```

Result: exit 0; 5 passed, 0 failed, 9 assertions across 3 files.

Typecheck (working directory `packages/workspace-contract`):

```powershell
& 'C:\Users\amits\AppData\Roaming\npm\node_modules\bun\bin\bun.exe' run typecheck
```

Result: exit 0; `$ tsc --noEmit`.

Staged-diff validation before commit: `git diff --cached --check` exited 0, and the staged name list contained only `packages/workspace-contract/**`.

## Files

- `packages/workspace-contract/package.json`
- `packages/workspace-contract/tsconfig.json`
- `packages/workspace-contract/src/types.ts`
- `packages/workspace-contract/src/spec.ts`
- `packages/workspace-contract/src/spec.test.ts`
- `packages/workspace-contract/src/state-machine.ts`
- `packages/workspace-contract/src/state-machine.test.ts`
- `packages/workspace-contract/src/public-events.ts`
- `packages/workspace-contract/src/public-events.test.ts`

## Commit

`bc528f498bc4b29c745483f96af6523464416b6b` — `feat(workspace): add durable contract primitives`

## Concerns

- No code concerns identified for Task 1.
- On Windows, the plan's literal `*.test.ts` filter was not expanded by PowerShell, so the verified RED and GREEN runs used the same three explicit test paths.
- Bun 1.3.14 printed usage instead of executing the plan-form `bun --cwd ... run typecheck`; running `bun run typecheck` from the package working directory executed `tsc --noEmit` successfully.
- The report is intentionally untracked and was not staged or committed.

## Review follow-up

All three reviewer claims were verified against the committed implementation before edits.

### RED evidence

1. Nested metadata: `bun test packages/workspace-contract/src/spec.test.ts` exited 1 with 2 passed and 1 failed. Changing `Assumption.status` retained the approved hash instead of invalidating approval.
2. Public paths: `bun test packages/workspace-contract/src/public-events.test.ts` exited 1 with 3 passed and 4 failed. The event exposed a Windows drive path, UNC path, POSIX absolute path, and parent traversal.
3. JSON persistence: `bun test packages/workspace-contract/src/spec.test.ts` exited 1 with 3 passed and 2 failed. Hashes changed after JSON round trips for both an undefined object property and an undefined array item.

### GREEN evidence

1. Nested metadata: the focused spec suite passed 3/3 after limiting approval-metadata exclusion to the root specification object.
2. Public paths: the focused public-event suite passed 7/7 after accepting only normalized workspace-relative paths and omitting unsafe paths.
3. JSON persistence: the focused spec suite passed 5/5 after omitting undefined object properties and canonicalizing undefined array items as `null`.

Final Task 1 test command passed 13/13 tests with 22 assertions across the three contract suites. Package typecheck ran `$ tsc --noEmit` and exited 0. `git diff --cached --check` exited 0 before the follow-up commit, whose staged list contained only four `packages/workspace-contract/src/**` files.

### Review-fix commit

`65913a01f28c38ad97f8a2d76a00743600804aac` - `fix(workspace): harden contract boundaries`

### Follow-up concerns

- No remaining code concerns identified for the three reviewed findings.
- The report remains intentionally untracked and was not staged or committed.

## Second review follow-up

The sparse-array finding was verified: `Array.prototype.map()` skipped holes, while JSON persistence materialized them as `null`.

### RED evidence

`bun test packages/workspace-contract/src/spec.test.ts` exited 1 with 5 passed and 1 failed. The sparse-array specification hash differed from the hash after a JSON round trip.

### GREEN evidence

Indexed array iteration now canonicalizes every position, including missing and explicit undefined slots, as `null`. The focused spec suite passed 6/6. Final Task 1 verification passed 14/14 tests with 23 assertions across three suites, and package typecheck ran `$ tsc --noEmit` with exit 0.

### Sparse-array commit

`46a352bab84781edb536d61170cf2fcb7f24eeae` - `fix(workspace): canonicalize sparse array slots`

### Second follow-up concerns

- No remaining concerns for the sparse-array finding.
- The report remains intentionally untracked and was not staged or committed.
