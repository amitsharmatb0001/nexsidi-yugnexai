# Task B1 Report — Gemini Tier Routing

**Status:** DONE
**Commit:** 9f5529c
**Branch:** feat/nexsidi-pipeline-v2-eager

---

## What Changed

### `packages/llm-client/src/types.ts`
Added three new entries to the `ModelId` union after `"gemini-3.5-flash"`:
- `"gemini-3.1-pro-preview"` — qa tier primary (unlimited thinking)
- `"gemini-3.6-flash"` — qa/generation tier fallback
- `"gemini-2.5-flash-lite"` — user tier primary (cheapest)

### `packages/llm-client/src/gemini.ts`
Extended `geminiChat` signature:
- Added `model?: string` to opts — callers can now specify a model; falls back to `resolveGeminiModel()` if omitted (matching `geminiChatWithTools`'s existing pattern)
- Added `thinkingBudget?: number` to opts — when provided, injects `thinkingConfig: { thinkingBudget }` into `generationConfig` (value `-1` means unlimited thinking for the qa tier)

### `packages/llm-client/src/router.ts`
Added exported `routeWithFallback(tier, messages, opts)` function:
- Three tiers: `"qa"` / `"generation"` / `"user"`
- Tier pools: qa=[gemini-3.1-pro-preview, gemini-3.6-flash, gemini-3.5-flash], generation=[gemini-3.6-flash, gemini-3.5-flash], user=[gemini-2.5-flash-lite, gemini-3.5-flash]
- Thinking budgets: qa=-1 (unlimited), generation=8192, user=1024
- Zero-wait fallback: on ANY error the loop immediately tries the next model — no sleep/backoff between pool members
- Returns `{ content: string; modelUsed: string }` so callers know which model actually served the request
- NIM is not involved — pure Gemini pool routing

---

## Type Check
`bun tsc --noEmit -p packages/llm-client/tsconfig.json` produced only 2 pre-existing errors:
- `types.ts:88` and `types.ts:103` — TS1117 duplicate object literal keys in `MODEL_RPM_LIMITS` and `NIM_CONTEXT_LIMITS` (both had a duplicate `"qwen/qwen3-next-80b-a3b-instruct"` key before this task). Zero new errors introduced.

---

## Files Modified
- `E:\ai yug\.claude\worktrees\eager-varahamihira-967edb\packages\llm-client\src\types.ts`
- `E:\ai yug\.claude\worktrees\eager-varahamihira-967edb\packages\llm-client\src\gemini.ts`
- `E:\ai yug\.claude\worktrees\eager-varahamihira-967edb\packages\llm-client\src\router.ts`
