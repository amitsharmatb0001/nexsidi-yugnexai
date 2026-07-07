# Task 1 Fix Re-Review

Verdict: APPROVED

## Original findings addressed?

**1. Path traversal in `checkpointPath` (Medium-High) — FIXED, verified myself.**
Wrote a throwaway probe script (`checkpoint-probe/probe.ts`, run via `bun run probe.ts`, not trusting
the implementer's claim) that imported the real `checkpoint.ts` from this worktree and reproduced the
exact original exploit plus two variants:

```
writeCheckpoint("../../escaped-project", "01-requirements", { pwned: true });
→ THREW: Invalid projectId: "../../escaped-project" — must not contain "..", "/", or "\"

writeCheckpoint("probe-project", "../../evil-stage", { pwned: true });   // traversal via `stage` instead
→ THREW: Invalid stage: "../../evil-stage" — must not contain "..", "/", or "\"

writeCheckpoint("C:\\Windows\\Temp\\pwned", "01-requirements", { pwned: true });  // absolute-path-style projectId
→ THREW: Invalid projectId: "C:\\Windows\\Temp\\pwned" — must not contain "..", "/", or "\"
```
`C:/escaped-project` was never created in any of these cases. A legitimate round-trip
(`writeCheckpoint("probe-legit-project", "01-requirements", {hello:"world"})` →
`readCheckpoint(...)` returns `{hello:"world"}`) still works, so the fix isn't overly destructive to
normal use. Confirmed fixed.

**2. `readCheckpoint` crashes ungracefully on malformed JSON (Medium) — FIXED, verified myself.**
In the same probe, I wrote garbage (`"{ not valid json"`) directly to
`C:/tmp/nexsidi-builds/probe-corrupt-reReview/checkpoints/corrupt-stage.json` and called
`readCheckpoint("probe-corrupt-reReview", "corrupt-stage")`:
```
THREW: Checkpoint corrupt: probe-corrupt-reReview/corrupt-stage — JSON Parse error: Expected '}'
```
No more raw uncontextualized `SyntaxError` — the thrown message names both `projectId` and `stage`,
and the "doesn't exist" path (`existsSync` → `null`) is untouched, so corruption and absence stay
distinguishable as the original review asked for. Confirmed fixed.

**3. No atomic write (Low) — FIXED, confirmed by reading the code, plus an extra probe of my own.**
`checkpoint.ts` now does `writeFileSync(tmpPath, ...)` then `renameSync(tmpPath, path)` where
`tmpPath = \`${path}.tmp\`` — same directory as the final file, so the rename is a same-volume atomic
rename, not a copy. I didn't just trust the commit message: I additionally probed the Windows-specific
edge case that matters most here — overwriting an *existing* checkpoint (the common case once a stage
runs more than once) — since Windows historically has different rename-over-existing-file semantics
than POSIX:
```
writeCheckpoint(PROJECT, "stage-a", { v: 1 });  readCheckpoint → { v: 1 }
writeCheckpoint(PROJECT, "stage-a", { v: 2 });  readCheckpoint → { v: 2 }
leftover .tmp file after successful overwrite? false
```
Overwrite succeeds cleanly with no leftover `.tmp` file. Confirmed fixed and working on this platform.

**4. `PipelineCheckpoint` type never defined (spec gap) — FIXED, and genuinely wired in (not just declared).**
`types.ts` now defines:
```typescript
export interface PipelineCheckpoint<T = unknown> {
  stage: string;
  data: T;
  writtenAt: string; // ISO timestamp
}
```
Confirmed it's actually used as the on-disk envelope, not just a decorative type: `writeCheckpoint`
builds `const envelope: PipelineCheckpoint = { stage, data, writtenAt: ... }` and serializes it;
`readCheckpoint<T>` parses into `PipelineCheckpoint<T>` and returns `envelope.data`. The **public**
signatures are unchanged from the original spec — `writeCheckpoint(projectId: string, stage: string,
data: unknown): void` and `readCheckpoint<T>(projectId: string, stage: string): T | null` — callers
never see the envelope shape, exactly as the plan intended. Confirmed fixed.

## Test verification

Ran it myself, independent of the implementer's report:
```
$ bun test pipeline/orchestrator/checkpoint.test.ts
bun test v1.3.14 (0d9b296a)

 5 pass
 0 fail
 5 expect() calls
Ran 5 tests across 1 file. [78.00ms]
```
All 5 pass (2 original + 3 new: traversal-via-writeCheckpoint, traversal-via-readCheckpoint,
malformed-JSON). Also confirmed `git diff e4dcc11 HEAD -- pipeline/orchestrator/checkpoint.ts
pipeline/orchestrator/types.ts pipeline/orchestrator/checkpoint.test.ts` is empty — no drift between
the reviewed fix commit and current HEAD.

## Validation regex judgment call (item 6)

`INVALID_IDENTIFIER = /\.\.|\/|\\/` rejects any `projectId`/`stage` containing `..`, `/`, or `\` —
not just traversal sequences. I checked this against every place `projectId` is actually produced in
this codebase, not just CLAUDE.md's D30 claim:

- `agents/maya/src/index.ts:137` — `hashContext({...}).slice(0, 12)`: a hex-digest slice, alphanumeric
  only, never contains `/` or `\`.
- `apps/api/src/routes/pipeline.ts:45` — `randomUUID().replace(/-/g, "").slice(0, 12)`: also hex-only.
- `pipeline/workflows/project-build.ts` stage values (`"spec"`, `"decompose"`, `"generate"`,
  `"compile_check"`, `"qa"`, `"live_test"`, `"deliver"`, `"done"`) and the test file's stage strings
  (`"01-requirements"`, `"corrupt-stage"`) — all flat slugs, never nested paths.

So for every legitimate call site, the strict regex is never triggered — it isn't "too strict" in
practice. It's also *not too loose*: blocking both `/` and `\` (not just `..`) matters concretely
because `checkpointPath` runs on Windows in this environment, where `\` is a live path separator that
a `..`-only check would miss (e.g. `stage = "..\\..\\evil"` contains `..` too, but a naive check for
just a leading `../` substring could be evaded with backslashes — this regex correctly catches raw `\`
on its own, defense-in-depth even without `..`).

One more finding *for* the fix's necessity that the original review didn't have visibility into:
`apps/api/src/routes/pipeline.ts:45` shows `POST /api/pipeline/start` accepts an **externally-supplied**
`body.projectId` (`body.projectId?.trim() || randomUUID()...`) with **no server-side sanitization**
before it's used. If a checkpoint call is ever added downstream of that route (not the case today —
grep confirms `writeCheckpoint`/`readCheckpoint`/`PipelineCheckpoint` currently have zero consumers
outside this module's own files, matching the original review's note), `checkpointPath`'s validation
would be the only thing standing between an attacker-chosen `projectId` and a path-traversal write.
This makes the strict slug-only regex the right default now, not a premature restriction — it's cheap
insurance against a real (if not yet wired-up) attacker-reachable path.

## Findings

None found. All four original findings are fixed and independently verified (not just re-read from
the diff or the implementer's report). The atomic-write overwrite case — the scenario most likely to
matter in practice once a stage re-runs — was tested directly on this Windows environment and behaves
correctly. The validation regex is appropriately strict for how `projectId`/`stage` are actually
generated and used today, and is defensible as forward-looking hardening given the unsanitized
external `projectId` input at `apps/api/src/routes/pipeline.ts:45`.

Minor, non-blocking observations (not required fixes, noted for awareness only):
- The regex also rejects `:` etc. only incidentally (it doesn't target it), so Windows alternate-data-stream
  tricks (e.g. `projectId = "foo:bar"`) aren't explicitly blocked — but such a value can't escape the
  build directory tree, so it isn't a path-traversal risk, just outside this fix's stated scope.
- No test covers concurrent writes to the same `stage.json.tmp` from two processes racing on the same
  project/stage; the original review already scoped race conditions as out of bounds for this
  synchronous, stateless module, and I agree that's reasonable for Task 1's scope.

## Recommendation

APPROVED. Safe to build on top of in Task 10+. All four original findings (path traversal, ungraceful
JSON crash, non-atomic write, missing `PipelineCheckpoint` type) are fixed, each independently
reproduced/verified by me (not taken on the implementer's word), the full test suite passes (5/5), and
there is no drift between the reviewed commit `e4dcc11` and current `HEAD` for the three touched files.
