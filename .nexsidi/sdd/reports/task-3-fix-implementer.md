# Task 3 Fix Report

Status: DONE

## What I did

**Fix 1 — atomic write for `writeGatewayRequest`.**
Mirrored `checkpoint.ts`'s `writeCheckpoint` pattern exactly: `writeGatewayRequest` now
writes to `${path}.tmp` via `writeFileSync`, then `renameSync`s it onto the final path.
Added `renameSync` to the `fs` import. No signature change — still synchronous,
still `void`.

**Fix 2 — race-tolerant retry in `readGatewayDecision`.**
`decision.json` is written by an external process (a human/UI, not this codebase), so
`gateway.ts` cannot guarantee that writer is atomic. `readGatewayDecision` now retries
on `JSON.parse` failure: up to 3 total attempts, with a 50ms delay between attempts
(2 delays for 3 attempts), before throwing the existing
`Gateway decision corrupt: {projectId}/{stage} — {message}` error. Retry constants
(`DECISION_READ_RETRY_DELAY_MS = 50`, `DECISION_READ_MAX_ATTEMPTS = 3`) are
module-level, not exposed on the public API — no configurable-delay parameter was
added, per the task's "don't over-engineer" guidance.

**`readGatewayDecision` became `async`.** A real delay between retries requires either
`async`/`await` or a synchronous blocking sleep (`Atomics.wait`/busy-wait). I chose
`async` — the idiomatic choice — after confirming via `grep -rn "readGatewayDecision" pipeline/ agents/`
that the only call sites in the entire repo are inside `gateway.test.ts` itself.
Task 5 (`stage2-gateway.ts`, the future poll-loop caller) has not been built yet, so
there is no existing synchronous caller anywhere in the codebase to break. New
signature: `readGatewayDecision(projectId: string, stage: string): Promise<GatewayDecision | null>`.
`writeGatewayRequest` stayed synchronous — nothing about its fix required `async`.

Added a doc comment above `readGatewayDecision` explaining that external writers of
`decision.json` should write atomically (temp+rename) to avoid the race in the first
place, and that this function's retry is a defensive backstop, not a substitute for
that.

**Test file updates (`gateway.test.ts`):**
- All 4 tests that call `readGatewayDecision` are now `async` and `await` the call
  (or use `await expect(...).rejects.toThrow(...)` for the two throwing cases —
  a plain `expect(() => ...).toThrow()` around an async function does not catch a
  rejected promise, so the two path-traversal/corrupt-JSON tests needed the
  `rejects` form, not just an `await` added to the old sync-style assertion).
- `writeGatewayRequest`'s path-traversal test is untouched — it's still synchronous.
- Added one new test, `readGatewayDecision retries on unparseable JSON before giving
  up (race-tolerance backstop)`: writes a permanently-malformed JSON file, calls
  `readGatewayDecision`, asserts it eventually throws the corrupt-decision error, and
  additionally asserts elapsed time is `>= 90ms` — proving the 2 retry delays (~50ms
  each) actually happened rather than the function throwing immediately on the first
  parse failure. This is distinct from the pre-existing corrupt-JSON test, which only
  proves the eventual throw, not that retries occurred.

## Test output

```
$ bun test pipeline/orchestrator/gateway.test.ts
bun test v1.3.14 (0d9b296a)

 7 pass
 0 fail
 8 expect() calls
Ran 7 tests across 1 file. [298.00ms]
```

All 7 tests pass (6 original + 1 new retry-timing test).

## Commit

a0c49f5 — "fix: atomic write for gateway requests, race-tolerant retry for decision file reads"

## Concerns (if any)

- `readGatewayDecision`'s API surface changed from sync to async. This is safe today
  (confirmed no other caller exists), but it is a breaking change any future Task 5
  implementer must account for — they should write `stage2-gateway.ts`'s poll loop
  against the `Promise<GatewayDecision | null>` signature from the start rather than
  assuming sync.
- The retry backstop does not distinguish "external writer mid-write" from "file is
  genuinely and permanently corrupt" — after 3 failed attempts (~100ms total) it
  throws either way, per the task's explicit instruction that persistent failure
  should surface loudly rather than being silently absorbed. If real-world torn
  writes ever take longer than ~100ms to resolve, the retry budget may need tuning,
  but there's no evidence for that yet and I did not want to guess at a bigger number
  without data.
- Review Finding 3 (duplicated `assertValidIdentifier`/`INVALID_IDENTIFIER` and
  JSON-corruption try/catch pattern between `checkpoint.ts` and `gateway.ts`) was
  explicitly called out as low-severity/non-blocking and deferred to a future
  shared-helper refactor once a third consumer appears — left untouched here, as
  instructed.
