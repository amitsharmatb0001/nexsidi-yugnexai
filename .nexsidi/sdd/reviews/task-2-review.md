# Task 2 Review

Verdict: APPROVED

## Spec compliance

`resolveFlags()` in `pipeline/orchestrator/flags.ts` matches the plan's Step 3 implementation verbatim:

```ts
export function resolveFlags(): FeatureFlags {
  return {
    requireOtp: process.env.NEXSIDI_REQUIRE_OTP === "true",
    requirePayment: process.env.NEXSIDI_REQUIRE_PAYMENT === "true",
    deployTarget: process.env.NEXSIDI_DEPLOY_TARGET === "gcp" ? "gcp" : "local",
  };
}
```

- Three env vars, exactly as named in the plan: `NEXSIDI_REQUIRE_OTP`, `NEXSIDI_REQUIRE_PAYMENT`, `NEXSIDI_DEPLOY_TARGET`.
- Defaults: `requireOtp: false`, `requirePayment: false`, `deployTarget: "local"` when unset — matches the Global Constraint exactly ("safe/demo default, never accidentally require production gates").
- `deployTarget` is a closed two-value ternary (`"gcp"` if exactly `"gcp"`, else `"local"`) — any unrecognized value falls back to the safe `"local"` default, not an open passthrough. Consistent with `FeatureFlags.deployTarget: "local" | "gcp"` in `types.ts`.
- Return type is `FeatureFlags` imported from `./types.ts` (Task 1) — no duplicated type definition.
- No placeholders, no TODOs, no dead branches.

## Test verification

Ran alone:
```
$ bun test pipeline/orchestrator/flags.test.ts
bun test v1.3.14 (0d9b296a)
 2 pass
 0 fail
 2 expect() calls
Ran 2 tests across 1 file. [46.00ms]
```

Ran as part of the full orchestrator directory (`checkpoint.test.ts`, `flags.test.ts`, `gateway.test.ts`, `dag.test.ts` — 19 tests total), 3 consecutive times to rule out order-dependent flakiness:
```
$ bun test pipeline/orchestrator/
19 pass / 0 fail / 19 expect() calls   (x3, consistent)
```
No difference in outcome between isolated and full-directory runs. `grep -r "NEXSIDI_REQUIRE|NEXSIDI_DEPLOY"` across the whole repo confirms no other source or test file reads these three env vars today, so there is no live cross-file collision.

**However — the isolation risk you asked me to check is real, just not currently triggered.** I built a throwaway repro to confirm the underlying mechanism rather than reason about it abstractly: `bun test <dir>` runs all matched files in a single process, so a `process.env` mutation in one file is visible to every other file in the same invocation (confirmed empirically — one probe file set `process.env.LEAK_PROBE_VAR` without cleanup, a second probe file in the same run observed the leaked value and failed its assertion; both probe files were deleted after, and the orchestrator suite was re-run to confirm it returned to a clean 19/19).

Applied to `flags.test.ts` specifically: test 2 (`"resolveFlags respects env var overrides"`) sets `NEXSIDI_REQUIRE_OTP`/`NEXSIDI_DEPLOY_TARGET`, asserts, *then* deletes them — with no `try/finally` and no `afterEach`. If the `expect(...).toEqual(...)` call on that line ever fails (e.g. a future regression in `resolveFlags()`), the test throws before reaching the two `delete` statements, and `NEXSIDI_REQUIRE_OTP="true"` / `NEXSIDI_DEPLOY_TARGET="gcp"` remain set in `process.env` for the rest of that `bun test` process — including any later-loaded file. Test 1 happens to self-heal this (it unconditionally deletes all three vars at the top before asserting), which is why the suite is stable today regardless of file execution order. But that's incidental protection from test 1's own setup, not a guarantee — it only helps if test 1 runs after the polluting failure, and it does nothing for `NEXSIDI_REQUIRE_PAYMENT` pollution since no test in this file ever sets that var (moot today, but the pattern generalizes badly).

This is not blocking for Task 2 in isolation (spec compliance is exact, and today's suite is provably green both alone and in the full directory). But it's a real latent flakiness source that plan Task 10 will walk directly into: `stage2-gateway.ts` wraps `resolveFlags()`, and its own test file will very plausibly assert on `NEXSIDI_REQUIRE_OTP`/`NEXSIDI_DEPLOY_TARGET` too. Recommend fixing before or during Task 10 — either wrap test 2's body in `try { ... } finally { delete ...; delete ...; }`, or better, use `beforeEach`/`afterEach` to reset all three vars unconditionally (mirroring what test 1 already does defensively).

## Findings

1. (Non-blocking, flag for Task 10) `flags.test.ts` mutates `process.env` without a `try/finally` or `afterEach` reset. Empirically confirmed `bun test` shares one process across files in a directory run, so a failed assertion between the env-var set and the manual cleanup would leak state into whatever test file runs next in the same invocation. No current file reads the affected vars, so this is dormant today — but `stage2-gateway.test.ts` (Task 10) is a likely place for it to surface as a flaky, hard-to-diagnose failure.

## Recommendation

Approve Task 2 as delivered — `resolveFlags()` is correct, minimal, matches the plan exactly, defaults are the safe/demo-required `false`/`false`/`"local"`, and both isolated and full-directory test runs are green. Before or during Task 10 (`stage2-gateway.ts`, which consumes `resolveFlags()`), add proper `afterEach`/`try-finally` env cleanup to `flags.test.ts` to close the latent cross-file leak risk identified above — it doesn't need to block this task's approval.

On the edge-case question: treating any value other than the exact string `"true"` (e.g. `"TRUE"`, `"1"`, `"yes"`) as `false` for `requireOtp`/`requirePayment` is the correct, deliberate direction given the stated constraint — the default must never *accidentally* turn a gate on, and a strict-equality check is the simplest way to guarantee that. Confirmed by direct test: setting `NEXSIDI_REQUIRE_OTP=TRUE` or `=1` in the shell before running the suite still resolves to `requireOtp: false`. The flip side — an operator setting `NEXSIDI_REQUIRE_OTP=1` in production, intending to turn OTP *on*, and silently getting `false` instead — is a real operational footgun, but it's the safe-direction footgun (fails toward less gating, matching the explicit Global Constraint), not a security regression, and there's no spec requirement for validation/logging on unrecognized values. Worth a one-line code comment or a startup-time warning log for unrecognized-but-truthy-looking values in a later hardening pass, but not a blocker for this task.
