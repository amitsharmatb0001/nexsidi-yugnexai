# Task 1 Fix Report

Status: DONE

## What I did

1. **Path traversal fix (`checkpointPath`)** — added `assertValidIdentifier()`, called at the top of
   `checkpointPath()` for both `projectId` and `stage`. It rejects any value that is empty or contains
   `..`, `/`, or `\` (via `/\.\.|\/|\\/`), throwing `Error: Invalid projectId/stage: "<value>" — must not
   contain "..", "/", or "\\"`. This runs before any filesystem access in both `writeCheckpoint` and
   `readCheckpoint` (both route through `checkpointPath`), so a malicious/malformed identifier fails
   loudly with no partial writes and no directory creation. No silent sanitization — invalid input is a
   hard error, per the instruction.

2. **Malformed JSON handling (`readCheckpoint`)** — wrapped `JSON.parse` in try/catch. On failure it
   throws `Error("Checkpoint corrupt: ${projectId}/${stage} — ${originalError.message}")`, preserving the
   original parser message for debugging while adding the missing project/stage context. The pre-existing
   "no checkpoint exists" path (`existsSync` check) is untouched and still returns `null` — corruption and
   absence remain distinguishable.

3. **Atomic write (`writeCheckpoint`)** — now writes the JSON payload to `${path}.tmp` via `writeFileSync`,
   then calls `renameSync(tmpPath, path)`. Rename is atomic on the same filesystem/volume (both tmp and
   final path are siblings under the same checkpoints directory), so a crash mid-write leaves at most a
   stray `.tmp` file — readers never observe a partially-written `.json`.

4. **`PipelineCheckpoint` type** — added to `types.ts`:
   ```typescript
   export interface PipelineCheckpoint<T = unknown> {
     stage: string;
     data: T;
     writtenAt: string; // ISO timestamp
   }
   ```
   `writeCheckpoint` now builds this envelope (`{ stage, data, writtenAt: new Date().toISOString() }`) and
   serializes it. `readCheckpoint<T>` parses into `PipelineCheckpoint<T>` and returns `envelope.data`, so
   the public signatures (`writeCheckpoint(projectId, stage, data)` / `readCheckpoint<T>(projectId, stage):
   T | null`) are unchanged — the envelope is purely an on-disk implementation detail, invisible to callers.

**Tests updated/added** in `checkpoint.test.ts`:
- Existing round-trip test and "no checkpoint" test — unchanged in behavior, still pass (envelope is
  transparent to callers).
- New: `writeCheckpoint` throws on a path-traversal `projectId` (`"../../escaped-project"`).
- New: `readCheckpoint` throws on a path-traversal `projectId` (embedded `..` via
  `TEST_PROJECT + "/../escaped"`).
- New: malformed JSON written directly to a checkpoint file path causes `readCheckpoint` to throw an
  error matching `/Checkpoint corrupt: test-checkpoint-proj\/corrupt-stage/` — not a raw `SyntaxError`.
- Atomic write: no dedicated race test (not practical to test deterministically per the task's own
  guidance); the round-trip test continues to pass after the temp-file+rename change, which is the
  agreed-sufficient coverage.

## Test output

```
$ bun test pipeline/orchestrator/checkpoint.test.ts
bun test v1.3.14 (0d9b296a)

 5 pass
 0 fail
 5 expect() calls
Ran 5 tests across 1 file. [78.00ms]
```

All 5 tests pass (original 2 + 3 new).

Manually re-confirmed the reviewer's original path-traversal repro is now blocked and clean: attempting
`writeCheckpoint("../../escaped-project", ...)` throws before touching the filesystem; `C:/escaped-project`
does not exist after the test run.

## Commit

`e4dcc11` — "fix: sanitize checkpoint paths, atomic writes, clear error on corrupt JSON, add
PipelineCheckpoint type"

Files: `pipeline/orchestrator/checkpoint.ts`, `pipeline/orchestrator/types.ts`,
`pipeline/orchestrator/checkpoint.test.ts` (60 insertions, 5 deletions).

## Concerns (if any)

- The path-traversal regex (`/\.\.|\/|\\/`) rejects any `/` or `\` outright, not just traversal
  sequences — this means `projectId`/`stage` must be simple flat slugs with no subdirectory nesting.
  This matches the task's framing ("these should always be simple slug-like strings") and CLAUDE.md D30
  (`projectId` is a 12-char SHA-256 hash), so I judged this the correct default rather than a narrower
  check that only blocks `..`.
- Did not touch `bun.lock`, which shows as modified in `git status` — unrelated to this task, left as-is.
- `.nexsidi/` reports/reviews directories are untracked in git; I did not add them to the commit since the
  task's `git add` list only names the three source/test files.
