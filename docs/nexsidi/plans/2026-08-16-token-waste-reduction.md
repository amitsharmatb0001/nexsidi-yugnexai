# Token Waste Reduction — Round-Scoped QA Re-scans and Doomed-Retry Resends

> **For agentic workers:** Use nexsidi-subagent-dev (preferred) or
> nexsidi-planning execute mode to implement task-by-task.
> Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Cut real, measurable per-project token spend at its source —
not a budget cap (that's already built, see
`docs/nexsidi/plans/2026-08-11-cost-control.md`'s Task 1) — by fixing
two confirmed waste patterns identified from tonight's rivhdw1 build.

**Architecture:** Two independent fixes, unrelated files, safe to
parallelize:
1. Round-scoped QA re-scan — teach Navya/Karan/Deepika to focus on
   what changed since the LAST round instead of blindly re-exploring
   the whole codebase every round.
2. Health-gated generator retry — before a doomed retry resends a
   full stored conversation, check a cheap ping first, mirroring a
   pattern that already exists and works (`runWithQuotaWatchAndResume`)
   right next to the one that doesn't (`runGeneratorWithQuotaRetry`).

**Tech Stack:** No new dependencies — `packages/agent-runtime/src/qa-loop.ts`,
`agents/qa/{navya,karan,deepika}/src/index.ts`, and
`pipeline/activities/quota-retry.ts`.

## Global Constraints

- No change may reduce QA coverage or correctness to save tokens — a
  reviewer that misses a real bug because it skipped re-scanning a
  changed file pays the bug's cost back with interest, same principle
  as the cost-control plan.
- Every lever stays individually toggleable/revertable, matching this
  session's established convention (`QA_READ_CACHE_ENABLED`,
  `RELEVANT_CONTEXT_SELECTION_ENABLED`, `COST_BUDGET_CAP_USD`).
- A gap this session already fixed once — "a failed API call
  shouldn't trigger a full generator fix round" — is confirmed already
  handled correctly (`stage5-qa-fix-loop.ts:304`'s `routableFindings`
  filter, 2026-08-10). Do not re-solve this; if implementation finds a
  REMAINING gap in that fix's coverage, report it, don't silently
  rebuild it.

---

## Root cause note — a third originally-suspected gap turned out already fixed

Before writing this plan, direct code inspection (not memory) confirmed
`pipeline/orchestrator/stages/stage5-qa-fix-loop.ts:304` already filters
`review-incomplete` findings out of `routableFindings` before they ever
reach a generator — with a comment dated 2026-08-10 documenting the
exact same root cause and incident (project freshtst1) this plan's
author had independently suspected was still open. It is not. This is
the correct outcome of "verify against real code before writing a
plan," not a mistake — noting it here so nobody re-implements it.

---

## Task 1: Round-scoped QA re-scan instead of full re-explore every round

**Files:**
- Modify: `packages/agent-runtime/src/qa-loop.ts`
- Modify: `agents/qa/navya/src/index.ts`, `agents/qa/karan/src/index.ts`, `agents/qa/deepika/src/index.ts`
- Modify: `pipeline/orchestrator/stages/stage5-adversarial-qa.ts` (round-boundary hook point, same place Task 3 of the cost-control plan wired the shared read cache's clear)
- Test: `packages/agent-runtime/src/qa-loop.test.ts`

**Interfaces:**
- Produces: a `changedFilesSinceLastRound(projectId): Promise<string[]>`
  or equivalent, computed from what Shubham/Aanya/Pranav actually wrote
  in the immediately-preceding fix round (their `filesWritten` result,
  already returned by every generator call per `GeneratorResult`'s
  shape — check `agents/generators/shubham/src/index.ts` for the exact
  field) — NOT from filesystem mtime (the existing per-round file-read
  cache already made a deliberate, documented choice to avoid mtime for
  correctness reasons; reuse that reasoning here rather than
  reintroducing a timestamp dependency).
- Consumes: the existing `QAAgentConfig`/`runQAAgent` shape from
  `qa-loop.ts` (already extended with `projectId` by the cost-control
  plan's Task 1/3 — reuse that plumbing, don't duplicate it).

**Approach**: on round 1 (or whenever no prior round exists), behavior
is unchanged — a full explore is correct and necessary. On round 2+,
each reviewer's system prompt/task message should be told explicitly
which files changed since the last round (from the generator fix
results, already available to the orchestrator at
`stage5-qa-fix-loop.ts`'s call site) and instructed to focus fresh
reads on those files plus re-verify that previously-reported findings
on UNCHANGED files are still accurate (a finding on a file nobody
touched almost certainly still holds — but don't silently drop
findings without at least a cheap confirmation step, since a finding
could theoretically be invalidated by a change to a DIFFERENT file it
depends on).

- [ ] **Step 1: Write the failing test** — assert that on a round-2+
  call, the reviewer's task prompt/instructions reference only the
  actually-changed files as the primary focus, and that a full
  `list_files` recursive call is NOT the first action taken (compare
  against round-1 behavior, which should be unchanged).
- [ ] **Step 2: Run test, verify it FAILS** against current always-full-explore behavior.
- [ ] **Step 3: Implement.** Thread `changedFilesSinceLastRound` through
  the same round-boundary hook `stage5-adversarial-qa.ts` already uses
  for the cost-control plan's shared read-cache clear — this is the
  natural, already-proven integration point, don't invent a new one.
- [ ] **Step 4: Run test, verify it PASSES.**
- [ ] **Step 5: Real verification** — this changes reviewer BEHAVIOR
  (what they focus on), not just a mechanical code path, so unit tests
  alone are a weaker signal here than for a pure-logic change. If
  feasible without excessive cost, do at least one live 2-round QA
  cycle against a real or realistic fixture project and confirm
  round 2 genuinely reads fewer files than round 1 while still
  correctly catching a deliberately-reintroduced bug in a changed file
  (a real regression-catching check, not just "fewer tokens spent").
- [ ] **Step 6: Commit.**

---

## Task 2: Health-gated generator retry (mirror the pattern that already works)

**Files:**
- Modify: `pipeline/activities/quota-retry.ts`
- Test: `pipeline/activities/quota-retry.test.ts`

**Interfaces:**
- Modifies: `runGeneratorWithQuotaRetry<T>` to gain the same
  health-check-before-resume shape `runWithQuotaWatchAndResume`
  already has in this exact file — reuse `checkGeminiHealth` (already
  defined in this file) rather than writing a second implementation.

**Current gap, confirmed by direct inspection**: `runGeneratorWithQuotaRetry`
(lines 103-118 of `quota-retry.ts`) sleeps a fixed 90s then blindly
calls `attempt()` again — which internally reloads and resends the
FULL stored conversation history (confirmed hundreds of KB in real
rivhdw1 logs) — up to twice, with no check that the circuit breaker
has actually recovered before paying that cost. `runWithQuotaWatchAndResume`,
defined earlier in the SAME file for Tier 3's use, already does this
correctly: sleep, cheap ping (`checkGeminiHealth`, `maxTokens: 5,
fastFailOn429: true`), only re-invoke the expensive `attempt()` once
the ping confirms recovery.

- [ ] **Step 1: Write the failing test** — assert `runGeneratorWithQuotaRetry`
  calls a health-check function between the sleep and the retry
  attempt, and does NOT call `attempt()` again if the health check
  reports still-unhealthy (instead continuing to wait, mirroring
  `runWithQuotaWatchAndResume`'s poll loop shape — but bounded by the
  EXISTING `MAX_GENERATOR_QUOTA_RETRIES`/backoff constants, not
  `QUOTA_WATCH_MAX_POLLS`'s longer ~2h budget, since this function's
  callers expect its existing shorter-horizon contract to hold).
- [ ] **Step 2: Run test, verify it FAILS** against the current blind-retry implementation.
- [ ] **Step 3: Implement**, injecting `healthCheckFn` the same way
  `runWithQuotaWatchAndResume` already does (default `checkGeminiHealth`,
  overridable for tests) — match that existing function's parameter
  shape and DI pattern exactly rather than inventing a new one two
  functions apart in the same file.
- [ ] **Step 4: Run test, verify it PASSES.**
- [ ] **Step 5: Confirm no behavior change for the NON-doomed case** —
  a retry where the circuit genuinely has recovered by the time the
  health check runs must still succeed exactly as before; write a test
  for this specific case, not just the doomed-retry-avoidance case.
- [ ] **Step 6: Commit.**

## What this does NOT fix (explicitly out of scope)

- The already-fixed review-incomplete routing gap (see root-cause note above).
- Any change to `MAX_GENERATOR_QUOTA_RETRIES`'s count or
  `GENERATOR_QUOTA_RETRY_BACKOFF_MS`'s duration — Task 2 only gates
  WHETHER a retry resends full context, not how many retries happen or
  how long the backoff is.
- QA round count/stuck-detection thresholds — unrelated to this plan's
  two token-waste sources.

## Definition of done

Both tasks merged, full test suite passing, and — given Task 1
explicitly changes agent behavior rather than pure logic — at least
one live verification that round 2+ QA scans are measurably smaller
than round 1 while still catching a real, deliberately-reintroduced
regression in a changed file.
