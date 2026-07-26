# Task B2 Report — Gemini thought signature preservation + 80% context compaction

**Status:** DONE  
**Commit:** `6aff4706efdf8f4d123f6d03f3f9b2e87be66b57`  
**Branch:** `feat/nexsidi-pipeline-v2-eager`

---

## What changed

### `packages/llm-client/src/gemini.ts`

**1. `GeminiPart` type extended (line 117–121)**  
Added thought part to the union so Gemini 3.x thought/signature parts are typed correctly and not silently dropped when preserved in history:
```typescript
| { thought: true; text?: string; signature?: string }  // Gemini 3.x thought parts — preserve verbatim
```

**2. `GeminiChatWithToolsResult` interface extended (line 148)**  
Added `promptTokens?: number` field so the loop can read token usage from each response for compaction threshold decisions.

**3. `partsToText()` updated (line 165–170)**  
Filter now excludes thought parts from extracted text (they shouldn't appear as the model's visible response content):
```typescript
.filter((p): p is { text: string } => "text" in p && !("thought" in p))
```

**4. `geminiChatWithTools()` return (line 348)**  
Populates `promptTokens` from `data.usageMetadata?.promptTokenCount`.

### `packages/agent-runtime/src/gemini-loop.ts`

**5. Constants added (after line 36)**
```typescript
const GEMINI_CONTEXT_LIMIT = 900_000;
const COMPACT_AT_FRACTION = 0.80;
```

**6. Compaction logic added (before `const responseParts`, after stuck-loop check)**  
After every successful tool-calling response (i.e., when tool calls are present and all early exits are cleared), checks `response.promptTokens` against the 720K threshold. If exceeded:
- Splits messages into `sys` (system) + `nonSys`
- Keeps last 6 non-system messages (3 user+model pairs)
- Inserts a `[CONTEXT COMPACTED: N messages dropped]` user message as sentinel
- Reassigns `messages` (which `saveHistory()` captures by reference, so it picks up the compacted state)

---

## Correctness notes

- **Thought signature fix**: `rawParts` is pushed verbatim to messages history at line 224 of gemini-loop.ts. With the new `GeminiPart` union, thought parts (including their `signature` field) now survive the TypeScript type boundary rather than being dropped as unknown/cast. The Gemini API requires these parts to be re-sent exactly as received to avoid a 400 on multi-step calls.
- **Compaction timing**: Runs after the stuck-loop check (which returns early if stuck) and before `responseParts` collection. This means:
  - We compact when we know there ARE tool calls to process
  - The current model response (pushed at line 224) is included in `nonSys.slice(-6)`, so it is always preserved
  - Tool responses added later in the same iteration are added AFTER compaction, which is correct (they're fresh context)
- **`saveHistory` closure**: `messages` is declared with `let` and captured by reference in the `saveHistory` closure, so reassigning `messages = [...]` is reflected in all subsequent saves. ✓

---

## Pre-existing errors (not introduced by this task)

The following TypeScript errors existed before this change and were not touched:
- `packages/llm-client/src/types.ts:88,103` — duplicate property names
- `agents/*/` — `ModelId` type mismatches for `"qwen/qwen3.5-122b-a10b"` and `"google/gemini-3.5-flash"`
- `apps/web/` — JSX flag not set in `tsconfig.bun.json`
- `apps/api/src/workspaces/service.test.ts` — `PromiseSettledResult` property access

No errors were introduced in the changed files.
