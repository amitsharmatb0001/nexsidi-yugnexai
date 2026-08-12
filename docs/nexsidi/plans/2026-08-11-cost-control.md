# Token/Cost Control Implementation Plan

> **For agentic workers:** Use nexsidi-subagent-dev (preferred) or
> nexsidi-planning execute mode to implement task-by-task.
> Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Stop per-project LLM spend from growing unbounded, without
reintroducing the "amnesiac" correctness bug that the last cost-control
attempt caused.

**Architecture:** Four independent levers, in priority order: (1) a hard
per-project token/$ budget that halts BEFORE overspend instead of after,
(2) real relevant-context selection instead of full chronological replay,
(3) deduplicated QA reads across the three reviewers, (4) a lowered but
*safe* compaction threshold, backed by a structured fact ledger so
compaction can't silently drop a decision the way the 40K-token attempt did.

**Tech Stack:** No new dependencies — everything below lives in
`packages/agent-runtime/src/` (gemini-loop.ts, compaction.ts, qa-loop.ts)
and `pipeline/activities/`.

## Global Constraints

- Every fix here must not reintroduce the 2026-07-24 "amnesiac oscillation"
  bug: an agent silently forgetting an earlier decision/fix because it got
  summarized away, then re-breaking it.
- No change may reduce correctness to save cost — a cheaper agent that
  produces worse code just pays the QA-round-trip cost back with interest.
- All four levers must be individually toggleable/revertable — don't ship
  this as one big entangled change.

---

## Root cause (why this wasn't already implemented)

Direct answer to "why is the system not implementing things": the exact
mechanism you're describing — send only recent/relevant messages, not the
full history — **was built** (`compactGeminiHistory` in
`packages/agent-runtime/src/compaction.ts`). It's wired into
`gemini-loop.ts` at three call sites (on history load, before every model
call, and on emergency context-exceeded recovery).

But on 2026-07-24, its trigger threshold was deliberately raised from
**40,000 tokens to 750,000 tokens** (`COMPACTION_THRESHOLD_TOKENS` in
`gemini-loop.ts:61`). The 40K threshold had caused a real, documented bug:
compacting that aggressively made the agent "amnesiac" roughly every 40K
tokens, so a fix applied earlier in a session would get summarized away and
then silently re-broken later in the same session — a "fixes one thing,
breaks another" oscillation. Raising the threshold to 750K fixed that
correctness bug, but as a side effect made compaction almost never fire —
in practice a single generator run measures 190–311K tokens, comfortably
under the new threshold, so most projects never trigger compaction at all.
This is why a single call tonight sent 540,000+ input tokens: nothing was
wrong, the system was doing exactly what it was configured to do.

The plan at the time named two intended replacements for cost control:
explicit prompt caching (this part **was** built and is active — you can
see `cached` token counts in every Gemini usage log line) and a planned
"relevant-context selection" mechanism (send only the current task, touched
files, and open findings — not the full transcript). That second piece was
described in a code comment as the long-term fix, but **was never actually
built** — there is no reference to it anywhere else in the codebase. That's
the real gap: half of the intended cost-control design shipped, half never
did, and nothing was left to notice the gap because there's no cost
telemetry anywhere in the pipeline today.

---

## Task 1: Per-project hard token/$ budget with early halt

**Files:**
- Create: `packages/agent-runtime/src/cost-budget.ts`
- Modify: `pipeline/activities/index.ts` (generator + QA activity entry points)
- Modify: `packages/db/schema.ts` (add `token_spend` running total per project)
- Test: `packages/agent-runtime/src/cost-budget.test.ts`

**Interfaces:**
- Produces: `recordSpend(projectId, tokensIn, tokensOut, model): Promise<void>`
- Produces: `checkBudget(projectId): Promise<{ withinBudget: boolean; spentUsd: number; capUsd: number }>`
- Consumes: existing `usageMetadata` already logged on every Gemini call
  (`gemini.ts`'s `formatUsageLog` — the data needed already exists, it's
  just not persisted or checked against anything)

- [ ] **Step 1: Write the failing test**
```typescript
test("checkBudget halts once cumulative spend crosses the per-project cap", async () => {
  await recordSpend("proj1", 500_000, 10_000, "gemini-3.5-flash");
  const result = await checkBudget("proj1");
  expect(result.withinBudget).toBe(false); // assuming cap is set below this spend in test config
});
```
- [ ] **Step 2: Run test, verify it FAILS** — `checkBudget` doesn't exist yet.
- [ ] **Step 3: Implement `recordSpend`/`checkBudget`** against a real
  per-model $/token table (already have this from the claude-api skill's
  pricing reference — reuse those numbers for Gemini equivalents from
  Amit's own model docs).
- [ ] **Step 4: Wire `checkBudget` into every generator/QA activity entry
  point** in `pipeline/activities/index.ts` — if over budget, escalate to
  Tilotma with reason `"budget_exceeded"` using the SAME
  `escalateAndAwaitRetryDecision` pattern already used for stuck-state,
  instead of silently continuing.
- [ ] **Step 5: Run test, verify it PASSES.**
- [ ] **Step 6: Commit.**

**Why this is Task 1, not Task 4:** every other lever reduces the rate of
spend; only this one puts a ceiling on it. Ship this first so a config
mistake in Tasks 2–4 can't repeat tonight's outcome.

---

## Task 2: Real relevant-context selection (the mechanism that was planned but never built)

**Files:**
- Create: `packages/agent-runtime/src/context-selection.ts`
- Modify: `packages/agent-runtime/src/gemini-loop.ts` (replace raw history
  resend with selected context before each call)
- Test: `packages/agent-runtime/src/context-selection.test.ts`

**Interfaces:**
- Produces: `selectRelevantContext(fullHistory, currentTask, touchedFiles, openFindings): GeminiMessage[]`
- Consumes: `GeminiMessage[]` shape from `compaction.ts`

Approach: instead of a chronological prose summary (compaction.ts's current
approach — lossy, can drop a specific decision), maintain a **structured
fact ledger** per agent run, appended to (never rewritten) after every tool
call:
```typescript
interface FactLedgerEntry {
  type: "file_written" | "fix_applied" | "decision" | "error_resolved";
  file?: string;
  summary: string;    // one line, not a paragraph
  turnIndex: number;
}
```
Each model call sends: system prompt + current task + the fact ledger
(cheap — one line per entry, not full diffs) + only the last N raw turns
for immediate continuity. This directly avoids the 2026-07-24 bug class:
a decision recorded in the ledger can't be "summarized away" the way a
prose summary can silently drop it, because the ledger is append-only and
sent in full (it's small) rather than re-summarized every time.

- [ ] **Step 1: Write the failing test** — assert that a fact recorded 100
  turns ago (e.g. "switched bcryptjs to bcrypt") is still present in the
  context sent on turn 101, proving no silent forgetting.
- [ ] **Step 2: Run test, verify it FAILS** against current raw-history behavior.
- [ ] **Step 3: Implement `selectRelevantContext`** and the fact-ledger
  append hook (call it every time `messages.push({role: "model", ...})`
  happens in `gemini-loop.ts`).
- [ ] **Step 4: Run test, verify it PASSES.**
- [ ] **Step 5: Run the FULL existing gemini-loop.ts test suite** — this
  touches the exact code path the 2026-07-24 fix touched, so regression
  risk here is real, not theoretical.
- [ ] **Step 6: Commit.**

---

## Task 3: Deduplicate QA reads across Navya/Karan/Deepika

**Files:**
- Modify: `packages/agent-runtime/src/qa-loop.ts`
- Test: `packages/agent-runtime/src/qa-loop.test.ts`

**Interfaces:**
- Produces: `sharedFileReadCache(projectId): FileReadCache` — one read pass
  per file per QA round, shared across all three reviewer agents
- Consumes: existing `read_files`/`read_file` tool implementations

Currently confirmed live tonight: Navya, Karan, and Deepika each
independently call `read_files` on overlapping sets of files every single
round. A single shared cache keyed on file path + mtime, populated on first
read and served to all three from then on, cuts this to one read per file
per round instead of three.

- [ ] **Step 1: Write the failing test** — spawn three QA agents against
  the same fixture project, assert the underlying file-read tool is
  invoked once per unique file, not three times.
- [ ] **Step 2: Run test, verify it FAILS** against current independent-read behavior.
- [ ] **Step 3: Implement the shared cache**, scoped per QA round (cleared
  between rounds since files change between fix passes).
- [ ] **Step 4: Run test, verify it PASSES.**
- [ ] **Step 5: Commit.**

---

## Task 4: Lower the compaction threshold now that Task 2 exists

**Files:**
- Modify: `packages/agent-runtime/src/gemini-loop.ts`
  (`COMPACTION_THRESHOLD_TOKENS`)
- Test: extend existing gemini-loop.ts tests

**Interfaces:**
- Consumes: Task 2's `selectRelevantContext` as the actual compaction
  mechanism (replaces the current prose-summary `compactGeminiHistory` as
  the primary path; keep `compactGeminiHistory` only as the emergency
  fallback on a genuine context-length-exceeded error, which is what it's
  already used for at `gemini-loop.ts:384`)

Do NOT simply set this back to 40K — that reintroduces the exact bug it
was raised to fix, since the OLD compaction mechanism (lossy prose summary)
would still be doing the compacting. This task only makes sense **after**
Task 2 ships, because Task 2's fact ledger is what makes frequent, cheap
compaction safe.

- [ ] **Step 1: Write the failing test** — assert a run that previously hit
  540K+ tokens on a single call now stays under a much lower ceiling (target:
  under 150K per call) without losing any fact-ledger entries.
- [ ] **Step 2: Run test, verify it FAILS** at current threshold.
- [ ] **Step 3: Lower `COMPACTION_THRESHOLD_TOKENS`** to a value backed by
  measurement, not a guess — instrument a few real runs with Task 2 active
  first, then pick a threshold just above typical single-turn size.
- [ ] **Step 4: Run test, verify it PASSES.**
- [ ] **Step 5: Run the full suite once more — this is the highest-risk
  task for reintroducing the 2026-07-24 bug, so don't skip verification.**
- [ ] **Step 6: Commit.**

---

## What this does NOT fix (explicitly out of scope)

- **Batching.** Gemini's batch API is for async/offline jobs; this
  pipeline's interactive tool-calling loop structurally cannot use it. Any
  earlier assumption that "batching" was saving money here was likely
  never actually engaging — worth confirming but not part of this plan's
  scope, since there's no code path that would use it even if enabled.
- **Which GCP project/billing account is active.** Separate, already in
  progress (Amit is arranging a new GCP account).
- **Retiring the free-tier retry churn during quota exhaustion.** The
  90-second double-retry-then-escalate behavior is reasonable as-is;
  Task 1's budget cap is the real fix for cost, not retry tuning.

## Definition of done

All four tasks merged, full test suite passing, one real project run end-
to-end with per-call token usage logged and staying under the new
threshold, and a visible running-cost number surfaced somewhere in the
pipeline state (`getPipelineState` or equivalent) so a $2K number is
catchable in real time instead of discovered at $29K.
