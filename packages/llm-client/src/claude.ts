// Claude API escalation tier (D-escalation): when an agent's NIM tool-calling
// loop (see ./nim.ts + packages/agent-runtime/src/loop.ts) fails — hits
// MAX_ITERATIONS or completes with verification_passed: false — the pipeline
// retries the SAME task once against a real Claude model before giving up.
// See packages/agent-runtime/src/claude-loop.ts for the retry wrapper.
//
// Uses the official @anthropic-ai/sdk — never raw fetch — per this repo's
// convention (see nim.ts for the NIM-side fetch pattern this mirrors).
import Anthropic from "@anthropic-ai/sdk";
import { canRequest, recordFailure, recordSuccess } from "./circuit-breaker.ts";
import { waitForToken } from "./token-bucket.ts";
import type { ChatMessage } from "./types.ts";
import type { NimToolDef } from "./nim.ts";

// Exact string, no date suffix — Anthropic's most capable Opus-tier model.
// This is the "hardest problem" escalation tier: correct choice is Opus, NOT
// claude-sonnet-4-6 (lighter/faster mid-tier — wrong here on purpose).
export const CLAUDE_ESCALATION_MODEL = "claude-opus-4-8";

// Claude escalation calls are a rare one-shot retry (not a hot loop like
// NIM's per-agent traffic), so a single generous fixed ceiling is enough to
// stop a runaway retry storm. There's no per-model RPM table for Claude the
// way types.ts's MODEL_RPM_LIMITS covers multiple NIM models — just the one
// escalation model — so this stays a local constant instead.
const CLAUDE_RPM_LIMIT = 50;

// Anything requesting more than this many output tokens uses
// client.messages.stream(...).finalMessage() instead of .create(), per the
// SDK's own guidance for avoiding HTTP timeouts on large max_tokens.
const STREAMING_THRESHOLD = 8000;

// Default max_tokens for a tool-calling turn — generous enough for full file
// contents / multi-step reasoning, always routed through streaming (above
// STREAMING_THRESHOLD).
const TOOL_CALL_MAX_TOKENS = 16000;

function circuitKeyFor(model: string): string {
  return `claude:${model}`;
}

// Distinguishes a policy refusal (stop_reason: "refusal") from a thrown SDK
// exception — refusals are a successful HTTP response, not an error the SDK
// raises, so this is NOT one of Anthropic's typed exception classes.
export class ClaudeRefusalError extends Error {
  readonly category: string | null;

  constructor(category: string | null, explanation: string | null) {
    super(`[Claude] request refused (stop_reason: refusal)${category ? ` — category: ${category}` : ""}${explanation ? `: ${explanation}` : ""}`);
    this.name = "ClaudeRefusalError";
    this.category = category;
  }
}

// Uses the SDK's typed exception classes (not string-matching) to produce a
// readable message. Order matters: most specific subclass first.
function describeError(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) return `rate limited: ${err.message}`;
  if (err instanceof Anthropic.AuthenticationError) return `authentication failed: ${err.message}`;
  if (err instanceof Anthropic.PermissionDeniedError) return `permission denied: ${err.message}`;
  if (err instanceof Anthropic.NotFoundError) return `not found (bad model id?): ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return `connection error: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `API error (${err.status ?? "?"}): ${err.message}`;
  return String(err);
}

function extractText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

// ── One-shot chat (mirrors nimChat()'s shape) ──────────────────────────────

export async function claudeChat(
  messages: ChatMessage[],
  apiKey: string,
  opts?: { maxTokens?: number },
): Promise<{ content: string }> {
  const circuitKey = circuitKeyFor(CLAUDE_ESCALATION_MODEL);
  if (!canRequest(circuitKey)) {
    throw new Error(`[llm-client] Circuit breaker OPEN for ${CLAUDE_ESCALATION_MODEL} — all retries exhausted`);
  }

  await waitForToken(CLAUDE_ESCALATION_MODEL, CLAUDE_RPM_LIMIT);

  const client = new Anthropic({ apiKey });

  const systemParts: string[] = [];
  const anthropicMessages: Anthropic.Messages.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
    } else {
      anthropicMessages.push({ role: m.role, content: m.content });
    }
  }

  const maxTokens = opts?.maxTokens ?? 8000;

  const requestParams = {
    model: CLAUDE_ESCALATION_MODEL,
    max_tokens: maxTokens,
    // Extended thinking on Opus 4.8: adaptive only. Do NOT use budget_tokens
    // — it 400s on this model.
    thinking: { type: "adaptive" as const },
    // NOT setting temperature/top_p/top_k — removed/rejected on Opus 4.8.
    ...(systemParts.length > 0 ? { system: systemParts.join("\n\n") } : {}),
    messages: anthropicMessages,
  };

  try {
    const response = maxTokens > STREAMING_THRESHOLD
      ? await client.messages.stream(requestParams).finalMessage()
      : await client.messages.create(requestParams);

    // Always check stop_reason before reading content — a refusal carries
    // empty or partial content.
    if (response.stop_reason === "refusal") {
      throw new ClaudeRefusalError(response.stop_details?.category ?? null, response.stop_details?.explanation ?? null);
    }

    const content = extractText(response.content);
    recordSuccess(circuitKey);
    return { content };
  } catch (err) {
    recordFailure(circuitKey);
    if (err instanceof ClaudeRefusalError) throw err;
    throw new Error(`[Claude ${CLAUDE_ESCALATION_MODEL}] ${describeError(err)}`);
  }
}

// ── Tool-calling chat (mirrors nimChatWithTools()'s shape, Claude's native tool format) ──

export interface ClaudeToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ClaudeToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// Same discriminated-union shape as NimMessage (role system/user/assistant —
// no separate "tool" role): tool results are represented as a user-role
// message whose content is a list of tool_result blocks, which is what
// Claude's API actually requires. content blocks reuse the SDK's own
// ContentBlockParam type so tool_use/tool_result shapes are correct by
// construction instead of being hand-redefined.
export type ClaudeContentBlockParam = Anthropic.Messages.ContentBlockParam;

export type ClaudeMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ClaudeContentBlockParam[] }
  | { role: "assistant"; content: string | ClaudeContentBlockParam[] };

export interface ClaudeChatWithToolsResult {
  content: string;
  toolCalls: ClaudeToolCall[];
  stopReason: Anthropic.Messages.StopReason | null;
  // Raw response content blocks — callers building a multi-turn tool loop
  // must push this back as the assistant turn verbatim (not just the
  // extracted text) to preserve tool_use blocks, per the SDK's own guidance.
  rawContent: Anthropic.Messages.ContentBlock[];
}

export async function claudeChatWithTools(
  messages: ClaudeMessage[],
  tools: ClaudeToolDef[],
  apiKey: string,
): Promise<ClaudeChatWithToolsResult> {
  const circuitKey = circuitKeyFor(CLAUDE_ESCALATION_MODEL);
  if (!canRequest(circuitKey)) {
    throw new Error(`[llm-client] Circuit breaker OPEN for ${CLAUDE_ESCALATION_MODEL} — all retries exhausted`);
  }

  await waitForToken(CLAUDE_ESCALATION_MODEL, CLAUDE_RPM_LIMIT);

  const client = new Anthropic({ apiKey });

  const systemParts: string[] = [];
  const anthropicMessages: Anthropic.Messages.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
    } else {
      anthropicMessages.push({ role: m.role, content: m.content });
    }
  }

  const requestParams = {
    model: CLAUDE_ESCALATION_MODEL,
    max_tokens: TOOL_CALL_MAX_TOKENS,
    thinking: { type: "adaptive" as const },
    ...(systemParts.length > 0 ? { system: systemParts.join("\n\n") } : {}),
    messages: anthropicMessages,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Messages.Tool.InputSchema,
    })),
  };

  try {
    // TOOL_CALL_MAX_TOKENS (16000) is above STREAMING_THRESHOLD — always stream.
    const response = await client.messages.stream(requestParams).finalMessage();

    if (response.stop_reason === "refusal") {
      throw new ClaudeRefusalError(response.stop_details?.category ?? null, response.stop_details?.explanation ?? null);
    }

    const toolCalls: ClaudeToolCall[] = response.content
      .filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }));

    recordSuccess(circuitKey);
    return {
      content: extractText(response.content),
      toolCalls,
      stopReason: response.stop_reason,
      rawContent: response.content,
    };
  } catch (err) {
    recordFailure(circuitKey);
    if (err instanceof ClaudeRefusalError) throw err;
    throw new Error(`[Claude ${CLAUDE_ESCALATION_MODEL}] ${describeError(err)}`);
  }
}

// ── NIM tool def -> Claude tool def converter ──────────────────────────────
//
// Lets the EXISTING tool definitions in packages/agent-runtime/src/tools/*.ts
// (FILE_TOOL_DEFS, COMMAND_TOOL_DEF, HTTP_TOOL_DEF, DOCKER_TOOL_DEF,
// WEB_SEARCH_TOOL_DEF, SCREENSHOT_TOOL_DEF — all NIM's OpenAI-compatible
// {type:"function", function:{name,description,parameters}} shape) be reused
// for a Claude-based loop without redefining every tool schema.
export function translateNimToolToClaudeTool(tool: NimToolDef): ClaudeToolDef {
  return {
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  };
}
