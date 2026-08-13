// Claude API escalation tier (D-escalation): when an agent's NIM tool-calling
// loop (see ./nim.ts + packages/agent-runtime/src/loop.ts) fails — hits
// MAX_ITERATIONS or completes with verification_passed: false — the pipeline
// retries the SAME task once against a real Claude model before giving up.
// See packages/agent-runtime/src/claude-loop.ts for the retry wrapper.
//
// Uses the official @anthropic-ai/sdk — never raw fetch — per this repo's
// convention (see nim.ts for the NIM-side fetch pattern this mirrors).
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { canRequest, recordFailure, recordSuccess } from "./circuit-breaker.ts";
import { waitForToken } from "./token-bucket.ts";
import type { ChatMessage } from "./types.ts";
import type { NimToolDef } from "./nim.ts";

// Exact string, no date suffix — Claude Sonnet 5, Anthropic's best combination
// of speed and intelligence per Anthropic's own model comparison. Used as the
// hardest-problem escalation tier per explicit user choice (not
// claude-sonnet-4-6, the lighter/older mid-tier model).
export const CLAUDE_ESCALATION_MODEL = "claude-sonnet-5";

// Vertex quota probe 2026-07-06 (scripts/ping-vertex-models.ts + Service
// Usage API): this GCP project has ZERO Vertex quota for claude-sonnet-5 but
// a pre-granted 15,000 tokens/min for claude-opus-4-1 / claude-sonnet-4 at
// us-east5. CLAUDE_MODEL overrides the escalation model per environment
// (e.g. set claude-opus-4-1 alongside CLAUDE_PROVIDER=vertex) without
// touching the direct-API default above.
export function resolveClaudeModel(): string {
  const override = process.env.CLAUDE_MODEL?.trim();
  return override ? override : CLAUDE_ESCALATION_MODEL;
}

// thinking:{type:"adaptive"} is only valid on Claude 4.6+ models — older
// models (claude-opus-4-1, claude-sonnet-4, ...) reject it with a 400, so
// requests must omit the thinking param entirely for them. Matched by model
// family rather than an allowlist so future 4.6+/5.x ids keep working.
export function supportsAdaptiveThinking(model: string): boolean {
  return (
    /claude-(sonnet|opus|haiku)-5/.test(model) ||
    /claude-fable/.test(model) ||
    /claude-(sonnet|opus)-4-[6-9]/.test(model)
  );
}

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

// GCP-credit fallback: when direct Anthropic billing is unavailable, the
// escalation tier can run through Claude on Vertex AI instead — same
// models, billed against GCP credit. Selected via CLAUDE_PROVIDER=vertex.
// AnthropicVertex extends the same BaseAnthropic class as Anthropic
// (confirmed against the installed SDK's own client.d.ts), so it's
// structurally interchangeable at every call site below (.messages.create,
// .messages.stream) — no adapter needed, just a different constructor.
//
// Region is NOT defaulted here on purpose: which GCP regions serve which
// Claude model changes over time and isn't something to hardcode from
// memory — check Anthropic's current Vertex AI region table (or the
// Vertex AI Model Garden page for Claude Sonnet 5 specifically) and set
// GOOGLE_CLOUD_REGION to a supported region before enabling this path.
function createClaudeClient(apiKey: string): Anthropic | AnthropicVertex {
  if (process.env.CLAUDE_PROVIDER !== "vertex") {
    return new Anthropic({ apiKey });
  }
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const region = process.env.GOOGLE_CLOUD_REGION;
  if (!projectId) {
    throw new Error("[llm-client] CLAUDE_PROVIDER=vertex requires GOOGLE_CLOUD_PROJECT to be set");
  }
  if (!region) {
    throw new Error(
      "[llm-client] CLAUDE_PROVIDER=vertex requires GOOGLE_CLOUD_REGION to be set — check Anthropic's current " +
      "Vertex AI region availability for claude-sonnet-5 before choosing one, it is not defaulted here",
    );
  }
  // Auth is via GCP Application Default Credentials (gcloud auth
  // application-default login), not an API key — apiKey is accepted here
  // for call-site symmetry with the direct-Anthropic path but is unused.
  return new AnthropicVertex({ projectId, region });
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

// ── Prompt caching (T7, full-system audit) ─────────────────────────────────
//
// Render order is tools -> system -> messages (shared/prompt-caching.md), so
// a single breakpoint on the (only) system block also caches every tool
// definition above it — no separate tools-level marker needed.
function cachedSystemBlocks(text: string): Anthropic.Messages.TextBlockParam[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

// thinking/redacted_thinking/mid_conv_system blocks don't accept cache_control
// (per shared/prompt-caching.md's supported-block-type list, and the SDK's
// own types) — an assistant turn can end in one of these if adaptive
// thinking produced trailing reasoning with no following text/tool_use.
type NonCacheableBlockType = "thinking" | "redacted_thinking" | "mid_conv_system";
function supportsCacheControl(
  block: Anthropic.Messages.ContentBlockParam,
): block is Exclude<Anthropic.Messages.ContentBlockParam, { type: NonCacheableBlockType }> {
  return block.type !== "thinking" && block.type !== "redacted_thinking" && block.type !== "mid_conv_system";
}

// Marks the last content block of a message so the growing conversation
// prefix is cached turn-over-turn (runAgentWithClaude in claude-loop.ts
// resends the SAME system+tools with an ever-longer message history on every
// iteration — this is the textbook multi-turn caching case). Exported for
// unit testing the block-shape logic without a live API call.
export function withCacheBreakpoint(
  content: string | Anthropic.Messages.ContentBlockParam[],
): Anthropic.Messages.ContentBlockParam[] {
  const blocks: Anthropic.Messages.ContentBlockParam[] =
    typeof content === "string" ? [{ type: "text", text: content }] : [...content];
  const last = blocks[blocks.length - 1];
  if (!last || !supportsCacheControl(last)) return blocks;
  blocks[blocks.length - 1] = { ...last, cache_control: { type: "ephemeral" } };
  return blocks;
}

// Applies withCacheBreakpoint to only the LAST message, leaving every earlier
// message untouched — each call rebuilds anthropicMessages fresh from the
// caller's ClaudeMessage[], so this never accumulates stale breakpoints
// across iterations (max 4 per request; here we use exactly 2: system + this).
export function withLastMessageCacheBreakpoint(
  messages: Anthropic.Messages.MessageParam[],
): Anthropic.Messages.MessageParam[] {
  const updated = [...messages];
  const last = updated[updated.length - 1];
  if (!last) return updated;
  updated[updated.length - 1] = { ...last, content: withCacheBreakpoint(last.content) };
  return updated;
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

  const client = createClaudeClient(apiKey);

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

  const model = resolveClaudeModel();
  const requestParams = {
    model,
    max_tokens: maxTokens,
    // Extended thinking on Sonnet 5: adaptive only. Do NOT use budget_tokens
    // — it 400s on this model. Omitted entirely on pre-4.6 override models,
    // where adaptive itself 400s.
    ...(supportsAdaptiveThinking(model) ? { thinking: { type: "adaptive" as const } } : {}),
    // NOT setting temperature/top_p/top_k — left unset (matches existing
    // behavior; not documented as removed for Sonnet 5, but no reason to add).
    ...(systemParts.length > 0 ? { system: cachedSystemBlocks(systemParts.join("\n\n")) } : {}),
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
    // T3+L10 (full-system audit): Claude usage was discarded here too —
    // this is the expensive tier, so visibility matters even more than on
    // the NIM side. Logged at this single call point rather than widening
    // the return type.
    // T7 follow-up: with caching active, input_tokens alone is misleading —
    // it's ONLY the uncached remainder (shared/prompt-caching.md: "input_tokens
    // is the uncached remainder only"). Logging cache_creation/cache_read
    // too is the only way to tell a real cache hit apart from a silent
    // invalidator forcing a full-price rewrite on every single call.
    console.log(`[claude:${model}] usage: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out / ${response.usage.cache_creation_input_tokens ?? 0} cache-write / ${response.usage.cache_read_input_tokens ?? 0} cache-read`);
    return { content };
  } catch (err) {
    recordFailure(circuitKey);
    if (err instanceof ClaudeRefusalError) throw err;
    throw new Error(`[Claude ${model}] ${describeError(err)}`);
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
  // 2026-08-13 (cost-control Task 1): response.usage was already read for
  // the console.log usage line right below where this is populated, then
  // discarded — claude-loop.ts (the only caller) had no way to see it. This
  // is the escalation tier (claude-loop.ts's runAgentWithClaude, reached via
  // runAgentEscalated when the NIM/Gemini path fails) — real spend at
  // Claude's rates, same recordSpend gap as loop.ts/gemini-loop.ts.
  usage: { inputTokens: number; outputTokens: number };
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

  const client = createClaudeClient(apiKey);

  const systemParts: string[] = [];
  const anthropicMessages: Anthropic.Messages.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
    } else {
      anthropicMessages.push({ role: m.role, content: m.content });
    }
  }

  const model = resolveClaudeModel();
  const requestParams = {
    model,
    max_tokens: TOOL_CALL_MAX_TOKENS,
    ...(supportsAdaptiveThinking(model) ? { thinking: { type: "adaptive" as const } } : {}),
    ...(systemParts.length > 0 ? { system: cachedSystemBlocks(systemParts.join("\n\n")) } : {}),
    messages: withLastMessageCacheBreakpoint(anthropicMessages),
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
    // T3+L10 / T7 follow-up: see claudeChat's identical comment above.
    console.log(`[claude:${model}] usage: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out / ${response.usage.cache_creation_input_tokens ?? 0} cache-write / ${response.usage.cache_read_input_tokens ?? 0} cache-read`);
    return {
      content: extractText(response.content),
      toolCalls,
      stopReason: response.stop_reason,
      rawContent: response.content,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    };
  } catch (err) {
    recordFailure(circuitKey);
    if (err instanceof ClaudeRefusalError) throw err;
    throw new Error(`[Claude ${model}] ${describeError(err)}`);
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
