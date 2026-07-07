# Task 3 Review

Verdict: NEEDS_FIXES

## Spec compliance

Function signatures match the plan exactly:
- `writeGatewayRequest(projectId: string, stage: string, summary: string): void` — matches Task 3's Interfaces line and Step 3 code sample verbatim.
- `readGatewayDecision(projectId: string, stage: string): GatewayDecision | null` — matches.

Decision file path convention matches: `requestPath` → `{buildDir}/{projectId}/gateway/{stage}.request.json`, `decisionPath` → `{buildDir}/{projectId}/gateway/{stage}.decision.json`. Confirmed against the plan's own Step 1 test (`02-gateway.decision.json` under a `gateway` subdirectory) and the implementation's `decisionPath`/`requestPath` helpers — identical layout.

`GatewayDecision` is consumed from `./types.ts` exactly as specified (`{ decision: "proceed" | "review"; feedback?: string }`), unchanged from Task 1.

Commit `a5bafdf` touches exactly the two files the plan's Step 5 `git add` line specifies, commit message matches Step 5 verbatim. No drift: `git diff a5bafdf HEAD -- pipeline/orchestrator/gateway.ts pipeline/orchestrator/gateway.test.ts` is empty.

## Test verification

Ran it myself, twice, independent of the implementer's report:
```
$ bun test pipeline/orchestrator/gateway.test.ts
bun test v1.3.14 (0d9b296a)

 6 pass
 0 fail
 6 expect() calls
Ran 6 tests across 1 file. [70-78ms]
```
**Confirmed: 6 tests, all passing.** The implementer's "6 tests" figure is correct. The apparent 5-vs-6 ambiguity comes from the report's prose breakdown ("Hardening tests added: path-traversal validation (projectId/stage), malformed JSON error handling" — two bullet phrases), which undercounts because "path-traversal validation" bullet actually covers **two** separate tests in the diff (one for `writeGatewayRequest`, one for `readGatewayDecision`), plus one malformed-JSON test = 3 hardening tests + 3 original tests = 6. The code and the test run agree; only the report's prose summary was ambiguous, not the count itself.

## Hardening equivalence check

**Path-traversal validation: genuinely equivalent protection, but copy-pasted, not shared — confirmed duplication risk.**
I diffed the two files byte-for-byte: `INVALID_IDENTIFIER` regex and `assertValidIdentifier()` in `gateway.ts` are **identical** to `checkpoint.ts`'s fixed version (only the surrounding import lines differ, because `gateway.ts` doesn't need `renameSync`). So the protection itself is exactly as strong as `checkpoint.ts` — same regex (`/\.\.|\/|\\/`), same rejection logic, same error message shape. This is not a "shortcut" or a weaker re-implementation.

However, it is a **re-implementation, not an import**. `gateway.ts` does not `import { assertValidIdentifier } from "./checkpoint.ts"` (or from a shared module) — it redeclares the same regex and function verbatim. The implementer's own report says "Reused the exact `assertValidIdentifier()` pattern from checkpoint.ts," which is accurate about the *pattern* but is worded in a way that could be misread as code reuse; it is duplicated source. This is a real maintenance risk exactly as the task description anticipated: if `checkpoint.ts`'s validation is tightened again later (e.g., to also reject absolute paths that don't contain `.`, `/`, or `\` on some platform, or Windows-specific edge cases like UNC paths), `gateway.ts` will not inherit the fix and could silently regress to the vulnerable state while looking hardened. There is no shared `pipeline/orchestrator/validation.ts` or similar; two independent copies of a security-relevant regex now exist.

**Malformed-JSON handling: genuinely equivalent, same duplication caveat.**
`readGatewayDecision`'s try/catch around `JSON.parse` matches `checkpoint.ts`'s `readCheckpoint` pattern exactly — same structure, same "extract `err.message` else `String(err)`" fallback, same contextual error message format (`"Gateway decision corrupt: {projectId}/{stage} — {message}"` vs. checkpoint's `"Checkpoint corrupt: {projectId}/{stage} — {message}"`). Confirmed by the corrupt-JSON test, which passes and asserts on the exact error message via regex. No weakness here; same duplication-not-import concern as above (lower risk in this case since the logic is trivial and unlikely to need future tightening the way path validation is).

**Atomic write: MISSING — this is the one hardening item the implementer did not mirror.**
`checkpoint.ts`'s fix commit (`e4dcc11`) added a write-temp-then-rename pattern to `writeCheckpoint` (`writeFileSync(tmpPath, ...); renameSync(tmpPath, path)`) specifically to address Finding 3 from the Task 1 review (non-atomic write → crash mid-write → corrupt file → the exact `JSON.parse` failure Finding 2 exists to handle gracefully). `gateway.ts`'s `writeGatewayRequest` still does a direct `writeFileSync(path, ...)` to the final path — no tmp file, no rename. `grep -n "renameSync|tmpPath" pipeline/orchestrator/gateway.ts` returns nothing. The implementer's report claims "Reused the exact `assertValidIdentifier()` pattern from checkpoint.ts" and describes applying "the same validation proactively... matching the design plan's 'apply lessons already learned this session' instruction" — but only 2 of the 3 lessons from the checkpoint.ts fix cycle were actually applied. The atomic-write lesson was dropped without comment (the report's "Concerns: None" section doesn't mention it).

Severity-wise this specific gap is milder than it was for `checkpoint.ts` (where it was rated Low/Optional): nothing in this module ever reads `request.json` back (no `readGatewayRequest` is exported), so a torn write there is a UI-display cosmetic issue at worst, not a resume-correctness issue. Still, it's an inconsistency worth calling out explicitly rather than leaving implicit, since it undermines the "mirrored the fix cycle" framing in the implementer's report — either fix it for consistency or note in the report that atomic-write was consciously scoped out (with the request.json cosmetic-risk reasoning above) so a later reviewer doesn't have to rediscover the omission from scratch.

## Findings

**1. (Medium — design/process) Atomic write from checkpoint.ts's fix cycle was not carried over to `writeGatewayRequest`.**
See "Hardening equivalence check" above. Recommend either adding the same tmp+rename pattern for consistency with the sibling module, or explicitly documenting the decision to omit it and why (request.json has no in-process reader, so torn writes are low-impact).

**2. (Medium — real, not hypothetical) Cross-process race on `decision.json` that `checkpoint.ts` structurally cannot have.**
`checkpoint.ts` has a single writer and reader: the orchestrator process itself, always going through `writeCheckpoint`'s atomic tmp+rename. `gateway.ts` is different in a way the plan itself documents (file map line 30: gateway.ts "matches existing `STEER.md`/`AGENT_STOP` pattern" — files a human edits directly) and the code comments confirm ("Polled by the orchestrator until the user (via UI/CLI) writes a decision file"). There is no exported `writeGatewayDecision` function anywhere in the codebase — the decision file's producer is entirely outside this module's control, is not guaranteed to write atomically, and per Task 5's design (`stage2-gateway.ts` calling `readGatewayDecision` presumably in a poll loop until non-null) `readGatewayDecision` will be called repeatedly while a human or external tool may be mid-write on `decision.json`.

The current implementation cannot distinguish "genuinely corrupted/abandoned decision file" from "human's editor/UI is mid-save, try again shortly" — both throw the identical `Gateway decision corrupt: ...` error. In a poll loop, a transient partial read during a legitimate save would produce a hard throw rather than being treated as "not ready yet" (which is exactly how the not-yet-exists case is already handled, via `null`). This is a plausible real-world failure mode given the documented human-edits-a-file UX pattern, not a contrived hypothetical. Recommend either: (a) the future poll-loop caller in `stage2-gateway.ts` catches this specific error and retries a bounded number of times before surfacing it as fatal, or (b) `readGatewayDecision` itself gets a short retry-on-parse-failure before throwing. Since `stage2-gateway.ts` doesn't exist yet (Task 5), this is a heads-up for that task rather than a blocking defect in Task 3's own diff — but it should be tracked now since Task 3 is where the API contract (throw vs. null vs. retry) gets locked in, and no test in `gateway.test.ts` documents which behavior callers should expect under this race.

**3. (Low — maintenance risk, not a bug today) Duplicated security-relevant code between `checkpoint.ts` and `gateway.ts`.**
`INVALID_IDENTIFIER`/`assertValidIdentifier` and the JSON-corruption try/catch pattern are copy-pasted verbatim rather than imported from a shared module. Currently harmless (both copies are correct and identical), but exactly the kind of drift risk the task description flagged: a future fix to one copy has no mechanism to propagate to the other. Worth a follow-up refactor (e.g. a shared `pipeline/orchestrator/paths.ts` exporting `assertValidIdentifier`) once a third consumer of the same pattern shows up (Task 4's DAG module or others), rather than blocking this task on it.

## Recommendation

NEEDS_FIXES, but all three findings are low-to-medium severity and none block Task 4+ from proceeding functionally — the gate is about closing the gap between what the implementer's report claims ("mirrored the fix cycle," "Concerns: None") and what's actually in the diff (2 of 3 hardening items mirrored, 1 silently dropped, 1 new race-condition risk unexamined):

1. Either add the tmp+rename atomic-write pattern to `writeGatewayRequest` for consistency with `checkpoint.ts`, or add one sentence to the implementer report explicitly scoping it out with the "no in-process reader of request.json" reasoning — don't leave the asymmetry undocumented.
2. Flag the `decision.json` cross-process race (Finding 2) for whoever implements Task 5's `stage2-gateway.ts` poll loop — it needs a defined retry/backoff contract around `readGatewayDecision`'s throw behavior, since the throw-vs-null distinction is being locked in here and will be awkward to change once Task 5 depends on it.
3. Optional, non-blocking: track the code-duplication risk (Finding 3) for a future shared-helper refactor; not worth doing now for a two-file duplication.
