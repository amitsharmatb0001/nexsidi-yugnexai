# Task 15 Fix Report — Sonnet 5 correction

Status: DONE

## What I did

Replaced every `claude-opus-4-8` reference in the Task 15 Claude escalation tier with `claude-sonnet-5`, per explicit user instruction (confirmed via live WebFetch of the models overview page, not a guess).

**`packages/llm-client/src/claude.ts`**
- Line 18: `export const CLAUDE_ESCALATION_MODEL = "claude-opus-4-8"` → `"claude-sonnet-5"`.
- Lines 15-17 (doc comment above the constant): rewrote to describe Sonnet 5 ("Anthropic's best combination of speed and intelligence per Anthropic's own model comparison") and the explicit-user-choice rationale, instead of "most capable Opus-tier model."
- Lines 104-108 (comment inside `claudeChat`'s `requestParams`): updated "Extended thinking on Opus 4.8" → "Extended thinking on Sonnet 5"; updated the temperature/top_p/top_k comment from "removed/rejected on Opus 4.8" to "left unset (matches existing behavior; not documented as removed for Sonnet 5, but no reason to add)" — since the task brief states there's no documented removal of these params for Sonnet 5, unlike Opus 4.8 where they're confirmed rejected.
- Confirmed `thinking: { type: "adaptive" as const }` is unchanged in both `claudeChat` and `claudeChatWithTools` — Sonnet 5 supports adaptive thinking identically to Opus 4.8, no code change needed there.
- Confirmed no `temperature`/`top_p`/`top_k` params exist anywhere in the file (grepped — zero occurrences before and after).

**`packages/llm-client/src/claude.test.ts`**
- Line 77: `expect(CLAUDE_ESCALATION_MODEL).toBe("claude-opus-4-8")` → `toBe("claude-sonnet-5")`. This was the only literal model-string assertion in the file.

**`packages/agent-runtime/src/claude-loop.ts`**
- Line 61: startup log line `Starting — model: claude-opus-4-8, ...` → `claude-sonnet-5`.
- Line 210: escalation log line `escalating to Claude (claude-opus-4-8) ...` → `claude-sonnet-5`.
- No other Opus/model-string references found in this file (grepped for "opus" case-insensitively — zero hits after the edit).

**`packages/agent-runtime/src/claude-loop.test.ts`**
- No changes needed. This file only tests `runAgentEscalated`'s orchestration logic via injected stubs (`AgentEscalationDeps`) — it contains zero literal `claude-opus-4-8` / model-string references. Confirmed via grep before editing.

**Full-repo verification (`grep -rn "claude-opus-4-8" --include="*.ts" .`):** ran before and after. Before: matches in the 4 target-adjacent files above plus `agents/tilotma/src/index.ts` (comment) and vendor `node_modules/@anthropic-ai/sdk` type definitions (untouched, correctly out of scope — those are the SDK's own model-ID union types, not this repo's code). After: only the out-of-scope files remain (see Concerns).

`packages/agent-runtime/src/tools/websearch.ts` (not in the target file list, and not edited) imports and uses `CLAUDE_ESCALATION_MODEL` as a constant rather than a hardcoded string — it picks up the `claude-sonnet-5` value automatically with no edit required. Verified via grep: it references `model: CLAUDE_ESCALATION_MODEL`, not a literal string.

## Test output

### claude.test.ts + claude-loop.test.ts (target scope)
```
$ bun test packages/llm-client/ packages/agent-runtime/
bun test v1.3.14 (0d9b296a)

packages\agent-runtime\src\claude-loop.test.ts:
[test-agent:escalation] NIM path failed (success=false) after 40 iterations — escalating to Claude (claude-sonnet-5) as one-time retry
[test-agent:escalation] NIM path failed (success=false) after 40 iterations — escalating to Claude (claude-sonnet-5) as one-time retry
[test-agent:escalation] NIM path failed (success=false) after 40 iterations — escalating to Claude (claude-sonnet-5) as one-time retry

 18 pass
 0 fail
 53 expect() calls
Ran 18 tests across 5 files. [607.00ms]
```
Console log lines confirm the escalation path now names `claude-sonnet-5`.

### Full regression suite
```
$ bun test pipeline/orchestrator/ packages/agent-runtime/ packages/context-chain/ agents/qa/ agents/tilotma/ agents/riya/ agents/generators/ packages/llm-client/
bun test v1.3.14 (0d9b296a)

 107 pass
 0 fail
 212 expect() calls
Ran 107 tests across 20 files. [845.00ms]
```
Same pass count as before the fix (107) — no regressions.

### Typecheck
```
$ bun run --cwd packages/llm-client typecheck
$ tsc --noEmit
(clean, no output)
```

## Commit

21efc56 — "fix: use claude-sonnet-5 instead of claude-opus-4-8 for escalation tier, per explicit user choice"

(Touched exactly the 4 files listed above: `packages/llm-client/src/claude.ts`, `packages/llm-client/src/claude.test.ts`, `packages/agent-runtime/src/claude-loop.ts`, `packages/agent-runtime/src/claude-loop.test.ts`.)

## Concerns

1. **`agents/tilotma/src/index.ts` (comment: "Uses claude-opus-4-8 (Anthropic SDK) as its brain"), `packages/db/src/migrations/0000_initial.sql` (seed row `('tilotma', 'claude-opus-4-8', 'orchestrator', 1)`), and `pipeline/.env` (comment header) still say `claude-opus-4-8`.** These are Tilotma's own orchestrator model configuration — a separate, pre-existing system unrelated to Task 15's Claude escalation tier (and notably inconsistent with `CLAUDE.md`'s roster table, which lists Tilotma on DeepSeek V4-Pro, not Claude — that inconsistency predates this fix). Left untouched per the explicit instruction to scope this strictly to the Task 15 escalation tier files and not touch other model IDs elsewhere in the codebase. Flagging in case the user wants a separate follow-up.
2. **`.nexsidi/sdd/reports/task-15-implementer.md`** (untracked, historical record of the original Task 15 implementation) still references `claude-opus-4-8` throughout — left as-is since it's a point-in-time report of what was actually built at the time, not live code; rewriting history in a report file seemed wrong. Not committed either way (it's untracked, per the existing convention noted in that same report).
3. Per the task brief, Sonnet 5's `effort` parameter defaults to `high` (same as Opus 4.8) and Task 15 never set `effort` explicitly — confirmed via grep, `effort` does not appear anywhere in `claude.ts` or `claude-loop.ts`, so no change was needed there either.
