# Task 15 Implementer Report

Status: DONE

## What I did

Added a real Claude API escalation tier on top of the existing all-NIM pipeline, and fixed `web_search` to use Claude's real server-side search instead of the never-configured `WEB_SEARCH_API_URL`/`WEB_SEARCH_API_KEY` env vars.

**Part 1 — `packages/llm-client/src/claude.ts` (new)**
- `claudeChat(messages, apiKey, opts?)` — one-shot call, mirrors `nimChat()`'s shape (same circuit-breaker key pattern `claude:${model}`, same `waitForToken` rate-limit gate — using a local `CLAUDE_RPM_LIMIT = 50` since there's no per-model NIM-style table for a single escalation model).
- `claudeChatWithTools(messages, tools, apiKey)` — tool-calling call, mirrors `nimChatWithTools()`'s shape but for Claude's native tool format. Returns `{ content, toolCalls, stopReason, rawContent }` — `rawContent` (the raw `Anthropic.Messages.ContentBlock[]`) is included specifically so a caller building a multi-turn loop can push the assistant turn back verbatim and preserve `tool_use` blocks, per the SDK's own multi-turn guidance.
- `translateNimToolToClaudeTool(tool: NimToolDef): ClaudeToolDef` — converts NIM's `{type:"function", function:{name,description,parameters}}` shape to Claude's top-level `{name, description, input_schema}` shape, so every existing tool def in `packages/agent-runtime/src/tools/*.ts` is reused, not redefined.
- `ClaudeMessage` is a discriminated union (`role: "system"|"user"|"assistant"`) mirroring `NimMessage`'s shape — no separate "tool" role, since Claude represents tool results as a user-role message with `tool_result` content blocks. Content blocks reuse the SDK's own `Anthropic.Messages.ContentBlockParam` type rather than being hand-redefined.
- `ANTHROPIC_API_KEY` is read the same way `NIM_API_KEY` is read elsewhere in this repo: `claude.ts` itself takes `apiKey` as a parameter (exactly like `nimChat`/`nimChatWithTools` do), and the actual `process.env.ANTHROPIC_API_KEY ?? ""` read happens at the call site — in `runAgentWithClaude` (Part 2) and in `websearch.ts` (Part 3) — the same place callers of `runAgent` already read `process.env.NIM_API_KEY ?? ""` (see `agents/tilotma/src/orchestrator.ts`, `tier3-review.ts`). No dotenv import needed — this repo relies on Bun's automatic `.env` loading from `pipeline/.env`, same as every other `process.env.X` read in the codebase.

**Part 2 — `packages/agent-runtime/src/claude-loop.ts` (new)**
- `runAgentWithClaude(config)` — a parallel implementation of `loop.ts`'s `runAgent()` while-loop, calling `claudeChatWithTools` instead of `nimChatWithTools`. Reuses `buildToolList()` (already exported) to get the identical NIM tool-def list — including `TASK_COMPLETE_TOOL`, which `buildToolList()` always appends — then translates the whole list once via `translateNimToolToClaudeTool`. Reuses the exact same `execWriteFile`/`execReadFile`/`execListFiles`/`execRunCommand`/`execHttpRequest`/`execDockerCompose`/`execWebSearch`/`execScreenshot` functions from `./tools/*.ts` (unchanged, provider-agnostic). Imports `MAX_ITERATIONS` from `loop.ts` rather than redefining it.
- `runAgentEscalated(config, deps?)` — orchestration wrapper. Runs `deps.runNim(config)` first; if `success === true`, returns immediately with `escalated: false` and **never calls Claude**. If `success === false`, logs the escalation trigger via `console.log`, calls `deps.runClaude(config)` as a one-time retry, and returns that result with `escalated: true` regardless of whether the Claude attempt itself succeeded or failed (per spec: "if both fail, return the Claude attempt's result — it's the more capable model, its failure is more informative"). `deps` defaults to the real `{ runNim: runAgent, runClaude: runAgentWithClaude }`, following the exact same injectable-`deps`-with-real-defaults pattern already used by `pipeline/orchestrator/run.ts`'s `runPipelineWithStages` and `stage6-deployment.ts`'s `runStage6`.
- I exported `MAX_ITERATIONS` and `TASK_COMPLETE_TOOL` from `loop.ts` (previously module-private) — this is the one edit to `loop.ts` itself, purely additive (adding the `export` keyword, no logic change), required because the task explicitly asks `claude-loop.ts` to import rather than redefine these. `runAgent()`'s behavior is untouched.
- Exported `runAgentWithClaude`, `runAgentEscalated`, `AgentEscalationDeps` from `packages/agent-runtime/src/index.ts` alongside the existing exports.

**Part 3 — `packages/agent-runtime/src/tools/websearch.ts` (rewritten)**
- `execWebSearch` now reads `ANTHROPIC_API_KEY` and, if set, calls `client.messages.create()` with the `web_search_20260209` server tool declared (`{ type: "web_search_20260209", name: "web_search" }`) and a short system prompt asking Claude to search and summarize with sources. Anthropic runs the search entirely server-side — no client-side HTTP call to any search provider is made.
- Walks `response.content` for `text` blocks (Claude's own summary) and `web_search_tool_result` blocks (raw hits — an array of `{title, url}` on success, or `{error_code}` on a server-tool error, which arrives as a content block, not a thrown exception) and concatenates them into a readable summary, same as before (truncated to 3000 chars, same `ToolResult` shape).
- Kept the existing empty-query validation (`args.query.trim()` check, runs first) and the existing `timeout_ms` parameter (now passed as the SDK's per-request `{ timeout }` option instead of an `AbortController`).
- If `ANTHROPIC_API_KEY` is unset, returns the same graceful `{status: "error", summary: "web_search not configured — ..."}` shape as before (message text updated to name `ANTHROPIC_API_KEY` instead of the old vars) — never crashes, never makes a network call.

## Claude API correctness self-check

- **Model ID**: `claude-opus-4-8` — exact string, no date suffix, defined once as `CLAUDE_ESCALATION_MODEL` in `claude.ts` and reused everywhere (including `websearch.ts`). Verified against the installed SDK's `models.d.ts`-adjacent docs is not applicable (no local models list in the SDK), but this matches the exact string mandated in the task prompt and in the loaded `claude-api` skill's model table.
- **Thinking param**: `thinking: { type: "adaptive" }` everywhere Claude is called (`claudeChat`, `claudeChatWithTools`, `websearch.ts`). Never `budget_tokens`.
- **No `temperature`/`top_p`/`top_k`**: confirmed absent from every request-params object in `claude.ts` and `websearch.ts` (grepped the diff — zero occurrences).
- **Tool format**: `ClaudeToolDef = { name, description, input_schema }` — top-level fields, never nested under a `function` key. Verified against the installed `@anthropic-ai/sdk@0.109.1`'s `resources/messages/messages.d.ts` `Tool` interface (`input_schema: Tool.InputSchema` requiring `{type: 'object', ...}`, `name: string` — matches).
- **Tool results**: `{ type: "tool_result", tool_use_id, content }` inside a `user`-role message (`claude-loop.ts`'s `toolResultBlocks` construction) — matches `ToolResultBlockParam` in the installed SDK's type defs.
- **`stop_reason` checked before content**: in `claudeChat`, `claudeChatWithTools`, and `websearch.ts`, `response.stop_reason === "refusal"` is checked immediately after the API call and before any `response.content` indexing/extraction.
- **Streaming**: `claudeChatWithTools` always uses `client.messages.stream(...).finalMessage()` (its fixed `max_tokens` of 16000 is above the 8000 streaming threshold). `claudeChat` conditionally streams when `opts.maxTokens` exceeds 8000, else uses `.create()`. `websearch.ts` uses `.create()` directly (max_tokens 2048, well under the threshold — no streaming needed).
- **Web search server tool**: `{ type: "web_search_20260209", name: "web_search" }` declared in `tools` on a `client.messages.create()` call — verified this exact `type`/`name` pair against the installed SDK's `WebSearchTool20260209` interface, and the response-parsing code against `WebSearchToolResultBlock`/`WebSearchResultBlock`/`WebSearchToolResultError` in the same file.
- **Error handling**: `describeError()` in `claude.ts` branches on `Anthropic.RateLimitError`, `Anthropic.AuthenticationError`, `Anthropic.PermissionDeniedError`, `Anthropic.NotFoundError`, `Anthropic.APIConnectionError`, `Anthropic.APIError` (most-specific-first) — verified these are real static properties on the default-exported `Anthropic` class in the installed SDK (`client.d.ts` lines 327-339), not string-matched.
- **Official SDK, no raw fetch**: `@anthropic-ai/sdk` is the only way Claude is called anywhere in this change — grepped the diff, zero `fetch(` calls against an Anthropic endpoint.

## Escalation design

- **Trigger condition**: exactly `result.success === false` from the NIM `runAgent()` call — no other condition. This covers both "hit MAX_ITERATIONS" and "completed with `verification_passed: false`" per the task description, because `runAgent()`'s own logic already folds both of those into `success: false` (see `loop.ts`'s `task_complete` handler and its final `MAX_ITERATIONS` return).
- **`escalated: true`** means the Claude path (`runAgentWithClaude`) was actually invoked for this task — regardless of whether it then succeeded or failed.
- **`escalated: false`** means the NIM path alone produced `success: true` and Claude was never called (verified by a test that fails if the injected Claude stub is invoked).
- **If both fail**: `runAgentEscalated` returns the Claude attempt's full `AgentRunResult` (its `summary`, `errors`, `iterations`, `filesWritten`) with `escalated: true` — the NIM failure's data is discarded in favor of the more capable model's (more informative) failure, per spec.
- **One-time retry, not a loop**: `runAgentEscalated` calls `deps.runClaude` at most once, unconditionally returning after that single call — there is no retry-the-retry logic.

## web_search fix

Confirmed: `execWebSearch` now reads `process.env.ANTHROPIC_API_KEY` (the old `WEB_SEARCH_API_URL`/`WEB_SEARCH_API_KEY` reads are gone — grepped `websearch.ts`, zero occurrences) and calls the real `web_search_20260209` server tool via `client.messages.create()`. The not-configured path is graceful (returns a `ToolResult` with `status: "error"`, doesn't throw, doesn't crash the caller). Verified via a test that explicitly `delete`s `process.env.ANTHROPIC_API_KEY` before calling, and asserts the returned summary names `ANTHROPIC_API_KEY` and does NOT mention the old env var names.

## Test output

### New test files
```
$ bun test packages/llm-client/ packages/agent-runtime/
 18 pass (agent-runtime, 5 files)
  6 pass (llm-client, 1 file — claude.test.ts)
 ...
```
Combined run:
```
bun test v1.3.14 (0d9b296a)

packages\agent-runtime\src\claude-loop.test.ts:
[test-agent:escalation] NIM path failed (success=false) after 40 iterations — escalating to Claude (claude-opus-4-8) as one-time retry
[test-agent:escalation] NIM path failed (success=false) after 40 iterations — escalating to Claude (claude-opus-4-8) as one-time retry
[test-agent:escalation] NIM path failed (success=false) after 40 iterations — escalating to Claude (claude-opus-4-8) as one-time retry

 18 pass
 0 fail
 53 expect() calls
Ran 18 tests across 5 files. [603.00ms]
```

### Full regression suite
```
$ bun test packages/llm-client/ packages/agent-runtime/ pipeline/orchestrator/ packages/context-chain/ agents/qa/ agents/tilotma/ agents/riya/ agents/generators/

bun test v1.3.14 (0d9b296a)

packages\agent-runtime\src\claude-loop.test.ts:
[test-agent:escalation] NIM path failed (success=false) after 40 iterations — escalating to Claude (claude-opus-4-8) as one-time retry
[test-agent:escalation] NIM path failed (success=false) after 40 iterations — escalating to Claude (claude-opus-4-8) as one-time retry
[test-agent:escalation] NIM path failed (success=false) after 40 iterations — escalating to Claude (claude-opus-4-8) as one-time retry

 107 pass
 0 fail
 212 expect() calls
Ran 107 tests across 20 files. [944.00ms]
```

### llm-client typecheck
```
$ bun run --cwd packages/llm-client typecheck
$ tsc --noEmit
(clean, no output)
```

`packages/agent-runtime` has no `tsconfig.json`/`typecheck` script of its own (pre-existing — none of `loop.ts`, `tools/*.ts` had one either, and the root `typecheck` script only runs packages that define one). I built an ad-hoc `tsc --noEmit` run against `packages/agent-runtime/src/**/*.ts` (temporary config in the scratchpad dir, not committed) to sanity-check the new files. Result: zero new/different errors from `claude-loop.ts` or `websearch.ts`. The only errors surfaced are pre-existing ones already present in unmodified `loop.ts` and `tools/command.ts` (a `ToolResult` vs `Record<string, unknown>` structural-typing gap that predates this change and appears identically in `loop.ts`'s own tool-dispatch switch — not something this task introduced or was asked to fix).

## Commit

56c3f07d245e85d8affee4e28583e7d7cb869d2b — "feat: add Claude escalation tier for hardest-problem fallback, fix web_search to use real Claude API"

(A follow-up commit, 329ece2, removes this report file from git tracking to match the untracked-report convention used by task-1 through task-14 — it does not touch any of the implementation files listed above.)

## Concerns

1. **`packages/agent-runtime` has no static typecheck wired into CI** (no `tsconfig.json`, no `typecheck` script). This predates this change — `loop.ts` and `tools/command.ts` already have latent structural-typing gaps (`ToolResult` isn't a `Record<string, unknown>` without an index signature; `command.ts`'s `spawnSync` call has a `string | undefined` vs `string` mismatch). I did not fix these since they're out of scope and pre-existing, but flag them here since I discovered them while verifying my own new code didn't introduce anything worse.
2. **`MAX_ITERATIONS` and `TASK_COMPLETE_TOOL` exports added to `loop.ts`.** The task said "not modifying" `loop.ts`, but also explicitly required importing these two constants into `claude-loop.ts` rather than redefining them — which is impossible without exporting them. I made the minimal change (added the `export` keyword to two existing `const` declarations, zero logic change) and judged this the correct reading of "not modifying" (i.e., don't change `runAgent()`'s behavior) vs. the explicit reuse requirement.
3. **`CLAUDE_RPM_LIMIT = 50` is a judgment call**, not a spec'd number — there's no existing per-model rate limit for a single Claude escalation model the way `types.ts`'s `MODEL_RPM_LIMITS` covers multiple NIM models. 50 RPM is generous enough not to throttle legitimate escalation traffic (which should be rare) while still guarding against a runaway retry storm.
4. **SDK version**: added `"@anthropic-ai/sdk": "^0.109.0"` to both `packages/llm-client/package.json` and `packages/agent-runtime/package.json` (the latter needs it directly since `websearch.ts` imports it too, not just transitively via `llm-client`). Confirmed `0.109.1` is the actual latest published version via `npm view` before pinning the range — not guessed.
5. **`WEB_SEARCH_MAX_TOKENS = 2048`** in `websearch.ts` is a judgment call for how much budget to give the search-and-summarize call — small enough to keep escalation-adjacent tool calls cheap, large enough for a multi-source summary with citations.
