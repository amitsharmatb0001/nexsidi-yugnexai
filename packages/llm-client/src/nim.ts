import { canRequest, recordFailure, recordSuccess } from "./circuit-breaker.ts";
import { waitForToken } from "./token-bucket.ts";
import { MODEL_RPM_LIMITS, NIM_CONTEXT_LIMITS, type ChatMessage, type ModelId } from "./types.ts";

const NIM_BASE_URL = process.env.NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1";

// Full-system audit T2: unlike http.ts's execHttpRequest, this file had no
// request timeout at all — a hung NIM connection stalled the whole pipeline
// indefinitely. Same AbortController pattern as http.ts, for consistency.
// Raised 120s -> 240s on 2026-07-04: stress4diag's log showed 3/3 aborts on
// mistralai/mistral-medium-3.5-128b (then-newly-promoted primary) firing at
// exactly the point request size grew (right after a multi-tool-call turn
// added several tool_results to history) — not on the FIRST request of a
// run. That pattern fits "slow-to-respond under free-tier load as context
// grows" far better than "the model hung outright" (ping-glm.ts showed a
// genuinely dead endpoint aborts on a trivial first request too, unlike
// this). 120s was never measured against real NIM response-time
// distribution — it was "add SOME timeout" (T2's original fix). Doubling it
// directly targets the specific failure just observed, rather than guessing
// at yet another model swap.
const NIM_TIMEOUT_MS = 240_000;

export interface NimResponse {
  id: string;
  choices: Array<{ message: { content: string } }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function nimChat(
  modelId: ModelId,
  messages: ChatMessage[],
  apiKey: string,
  maxTokensOverride?: number,
): Promise<NimResponse> {
  const circuitKey = `nim:${modelId}`;
  if (!canRequest(circuitKey)) {
    throw new Error(`[llm-client] Circuit breaker OPEN for ${modelId} — all retries exhausted`);
  }

  const rpmLimit = MODEL_RPM_LIMITS[modelId] ?? 40;
  await waitForToken(modelId, rpmLimit);

  // Code generation tasks (TaskList, dashboard pages, etc.) can exceed 4096 tokens.
  // Default cap is 16384 — callers can pass a lower override for spec/QA tasks.
  const contextLimit = NIM_CONTEXT_LIMITS[modelId] ?? 32768;
  const maxTokens = maxTokensOverride ?? Math.min(16384, Math.floor(contextLimit * 0.75));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NIM_TIMEOUT_MS);

  try {
    const res = await fetch(`${NIM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      // T6: low temperature reduces malformed JSON in tool arguments —
      // not used here (nimChat has no tool arguments to corrupt), kept for
      // parity/consistency with nimChatWithTools below.
      body: JSON.stringify({ model: modelId, messages, max_tokens: maxTokens, temperature: 0.2 }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      recordFailure(circuitKey);
      throw new Error(`[NIM ${res.status}] ${body}`);
    }

    const data = (await res.json()) as NimResponse;
    recordSuccess(circuitKey);
    // T3+L10 (full-system audit): usage was silently discarded everywhere —
    // a system whose pitch is cost-efficiency had no visibility into its
    // own token spend. Logged at this single lowest-common call point
    // rather than threaded through every caller's return type.
    console.log(`[nim:${modelId}] usage: ${data.usage.prompt_tokens} in / ${data.usage.completion_tokens} out / ${data.usage.total_tokens} total`);
    return data;
  } catch (err) {
    recordFailure(circuitKey);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Tool-calling types (OpenAI-compatible — NIM supports this format) ─────────

export interface NimToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface NimToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type NimMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: NimToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface NimToolResponse {
  choices: Array<{
    message: { role: string; content: string | null; tool_calls?: NimToolCall[] };
    finish_reason: "stop" | "tool_calls" | "length";
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function nimChatWithTools(
  modelId: ModelId,
  messages: NimMessage[],
  tools: NimToolDef[],
  apiKey: string,
): Promise<NimToolResponse> {
  const circuitKey = `nim:${modelId}`;
  if (!canRequest(circuitKey)) {
    throw new Error(`[llm-client] Circuit breaker OPEN for ${modelId} — all retries exhausted`);
  }

  const rpmLimit = MODEL_RPM_LIMITS[modelId] ?? 40;
  await waitForToken(modelId, rpmLimit);

  const contextLimit = NIM_CONTEXT_LIMITS[modelId] ?? 32768;
  // Full-system audit T1: raised from a hardcoded 8192 — a complete
  // multi-component page is 9-12K tokens of JSON-escaped write_file
  // arguments, so 8192 truncated mid-JSON on every non-trivial file
  // (confirmed root cause of the loop.ts sanitizeToolCalls death spiral).
  // 16000 matches Claude's TOOL_CALL_MAX_TOKENS (claude.ts) for parity.
  // Safe to raise now that loop.ts handles finish_reason==="length"
  // gracefully instead of poisoning history — raising the cap alone,
  // without that handling, would only have pushed truncation to bigger
  // files instead of eliminating the failure mode.
  const maxTokens = Math.min(16000, Math.floor(contextLimit * 0.75));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NIM_TIMEOUT_MS);

  try {
    const res = await fetch(`${NIM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        tools,
        tool_choice: "auto",
        max_tokens: maxTokens,
        // T6: lower temperature reduces malformed JSON in tool call
        // arguments — the server default (typically ~1.0) maximizes
        // formatting variance exactly where correctness matters most.
        temperature: 0.2,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      recordFailure(circuitKey);
      throw new Error(`[NIM ${res.status}] ${body}`);
    }

    const data = (await res.json()) as NimToolResponse;
    recordSuccess(circuitKey);
    // T3+L10: see nimChat's identical comment above.
    console.log(`[nim:${modelId}] usage: ${data.usage.prompt_tokens} in / ${data.usage.completion_tokens} out / ${data.usage.total_tokens} total`);
    return data;
  } catch (err) {
    recordFailure(circuitKey);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
