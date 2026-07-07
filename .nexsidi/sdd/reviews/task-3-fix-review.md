# Task 3 Fix Re-Review

Verdict: APPROVED

## Original findings addressed?

**Finding 1 (atomic write for `writeGatewayRequest`) — fixed, confirmed byte-for-byte equivalent to `checkpoint.ts`.**
`pipeline/orchestrator/gateway.ts:36-42`:
```ts
export function writeGatewayRequest(projectId: string, stage: string, summary: string): void {
  const path = requestPath(projectId, stage);
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, JSON.stringify({ summary, requestedAt: new Date().toISOString() }, null, 2), "utf-8");
  renameSync(tmpPath, path);
}
```
This is structurally identical to `checkpoint.ts:22-33`'s `writeCheckpoint` (same `${path}.tmp` naming, same `writeFileSync` → `renameSync` sequence, `renameSync` added to the `fs` import). Confirmed by direct comparison of both files, not just the diff.

**Finding 2 (cross-process race on `decision.json`) — fixed via retry-on-parse-failure, reasonably scoped.**
`readGatewayDecision` now loops up to `DECISION_READ_MAX_ATTEMPTS = 3` times, sleeping `DECISION_READ_RETRY_DELAY_MS = 50`ms between failed `JSON.parse` attempts, before throwing the same `Gateway decision corrupt: {projectId}/{stage} — {message}` error as before. The doc comment above the function correctly frames this as a "defensive backstop," not a substitute for the external writer using atomic writes — accurate framing, doesn't overclaim what the fix guarantees. Finding 3 (duplicated `assertValidIdentifier`/regex between `checkpoint.ts` and `gateway.ts`) was explicitly left out of scope in both the original review's recommendation (non-blocking, "not worth doing now for a two-file duplication") and the fix report — consistent, no silent drop this time.

## Async interface change verification

Confirmed independently, not trusting the fix report's claim. Ran:
```
grep -rn "readGatewayDecision" (whole repo)
```
8 matches total, in: `gateway.ts` (the definition), `gateway.test.ts` (the only caller), plus 6 doc/review artifacts (`task-3-review.md`, `task-3.diff`, `task-3-fix.diff`, `task-3-implementer.md`, `task-3-fix-implementer.md`, `docs/nexsidi/plans/2026-07-02-full-agentic-pipeline.md`). None of the doc matches are executable code — the plan doc at line 220 still shows the original *synchronous* signature as a code sample, which is now stale relative to the implementation, but it's a planning artifact, not a call site, so it doesn't break at runtime. `pipeline/orchestrator/` contains only `checkpoint.ts`, `dag.ts`, `flags.ts`, `gateway.ts`, `types.ts` — no `stage2-gateway.ts` or any other consumer exists yet. The implementer's claim ("no other caller exists") is verified correct.

(Minor, non-blocking, worth a one-line note to whoever picks up Task 5: the plan doc's inline code sample at `docs/nexsidi/plans/2026-07-02-full-agentic-pipeline.md:220-244` is now out of sync with the real signature — not a defect in this diff, just a heads-up so Task 5 isn't written against stale sync-style sample code.)

## Timing-test robustness check

Ran `bun test pipeline/orchestrator/gateway.test.ts` 3 times in a row: 7/7 pass every time, no flakes, no variance in outcome.

The elapsed-time assertion in the 7th test (`expect(elapsed).toBeGreaterThanOrEqual(90)`) is scoped correctly — `start`/`elapsed` are measured with `Date.now()` immediately around the single `readGatewayDecision` call inside that one test, not around the whole file. Bun runs tests sequentially within a file by default, so the other 6 tests' overhead happens entirely outside this test's timer window and cannot inflate or deflate its measured `elapsed`. The "could the other 6 tests' overhead cause a false pass" concern doesn't apply — it's structurally isolated.

To directly stress the actual margin (not just pass/fail), I wrote a standalone probe script that calls `readGatewayDecision` against a permanently-malformed file 10 times in a row, outside the test harness, and printed raw elapsed time per call:
```
elapsed(ms)= 124.55, 113.96, 129.54, 124.74, 129.61, 112.28, 115.29, 112.26, 121.66, 123.02
```
Every sample landed in a 112–130ms band — comfortably clear of the 90ms threshold (22–40ms of headroom), and none dipped anywhere near the boundary. `setTimeout` delays never fire early per spec/libuv implementation, only late, so genuine system slowness only pushes elapsed further above 90ms (still passes) — there is no mechanism by which real-world load could cause a false failure on the lower-bound assertion. This is a legitimately robust test, not a flaky one. (Probe script was temporary, run from the scratchpad, and has been deleted — not part of the diff.)

## Test verification

```
$ bun test pipeline/orchestrator/gateway.test.ts
bun test v1.3.14 (0d9b296a)

 7 pass
 0 fail
 8 expect() calls
Ran 7 tests across 1 file. [344ms / 291ms / 306ms across 3 runs]
```
All 7 tests pass consistently across 3 independent runs (6 original + 1 new retry-timing test). Matches the fix report's claimed output.

## Findings

None found. Both original findings are substantively fixed, the interface change is verified safe (no other real callers), and the new timing-sensitive test was independently stress-tested and found robust rather than just taken on faith.

One informational note only (not a defect, not blocking): `docs/nexsidi/plans/2026-07-02-full-agentic-pipeline.md` still shows the pre-fix synchronous `readGatewayDecision` signature in its Task 3 code sample. Worth a one-line update whenever Task 5 (`stage2-gateway.ts`) is started, so its author writes the poll loop against `Promise<GatewayDecision | null>` from the plan doc itself rather than only discovering the async signature by reading `gateway.ts` directly.

## Retry budget sanity check (order-of-magnitude, not a blocking concern)

A `JSON.stringify` + `writeFileSync` for a small decision object (`{decision, feedback?}`, well under 1KB) completes in well under 1ms on any local filesystem — call it microseconds to low-single-digit milliseconds worst case with filesystem overhead. A 50ms retry spacing is roughly 1-2 orders of magnitude larger than that, which is generous headroom for the intended failure mode (a torn read landing mid-write of a tiny file) without needing to be tuned further. On the other side: total worst-case latency before a genuine corruption surfaces is ~100ms (2 delays), which is negligible in this workflow's context — `decision.json` is written by a human/UI as part of an approval gate the orchestrator is already polling for, where the surrounding latency is measured in seconds-to-minutes of human decision time, not milliseconds. So neither direction is obviously wrong: 50ms/3-attempts is generous relative to the write it's meant to tolerate, and cheap enough relative to the human-timescale workflow it sits inside that a genuinely corrupt file doesn't take unreasonably long to be reported. This is a reasonable default; if real-world torn-write durations ever exceed ~100ms (e.g., decision.json written over a slow network mount), the fix report already flags that as a future tuning knob rather than claiming the number is proven correct — appropriately hedged, not overclaimed.

## Recommendation

APPROVED. Both Medium findings from the original review are fixed and verified against the actual source (not just the diff or the report's prose). The async signature change is a real interface change but is safe today and was independently confirmed to have no other callers in the repo. The new timing-dependent test was specifically interrogated for flakiness risk per this review's charter and found to be soundly isolated and comfortably margined (112–130ms observed vs. 90ms threshold), not a coin-flip test that happens to pass. No changes required before Task 4+ proceeds. The only follow-up is optional documentation hygiene (stale sync-signature sample in the plan doc) for whoever starts Task 5.
