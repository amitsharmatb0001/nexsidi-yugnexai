import { canRequest, recordFailure, recordSuccess } from "./circuit-breaker.ts";
import type { ChatMessage } from "./types.ts";
import type { NimMessage, NimToolDef, NimToolResponse } from "./nim.ts";

const OLLAMA_BASE_URL = process.env.OLLAMA_URL ?? "http://host.docker.internal:11434";

export interface OllamaResponse {
  model: string;
  message: { role: string; content: string };
  done: boolean;
}

export async function ollamaChat(
  model: string,
  messages: ChatMessage[],
): Promise<OllamaResponse> {
  const circuitKey = `ollama:${model}`;
  if (!canRequest(circuitKey)) {
    throw new Error(`[llm-client] Circuit breaker OPEN for ollama:${model}`);
  }

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
    });

    if (!res.ok) {
      recordFailure(circuitKey);
      throw new Error(`[Ollama ${res.status}]`);
    }

    const data = (await res.json()) as OllamaResponse;
    recordSuccess(circuitKey);
    return data;
  } catch (err) {
    recordFailure(circuitKey);
    throw err;
  }
}

// 2026-09-28: the agent tool loop (agent-runtime loop.ts) sent EVERY model to
// NIM, so a local model could never run there. Ollama serves the same
// OpenAI-style /v1/chat/completions (tools included) that NIM does, so the
// request and response shapes are NIM's. Only models in types.ts
// OLLAMA_TOOL_MODELS are routed here.
export async function ollamaChatWithTools(
  model: string,
  messages: NimMessage[],
  tools: NimToolDef[],
  opts: { baseUrl?: string; timeoutMs?: number } = {},
): Promise<NimToolResponse> {
  const circuitKey = `ollama:${model}`;
  if (!canRequest(circuitKey)) {
    throw new Error(`[llm-client] Circuit breaker OPEN for ollama:${model}`);
  }
  try {
    const res = await fetch(`${opts.baseUrl ?? OLLAMA_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, tools, tool_choice: "auto", temperature: 0.2, stream: false }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 240_000),
    });
    if (!res.ok) {
      recordFailure(circuitKey);
      throw new Error(`[Ollama ${res.status}] ${await res.text()}`);
    }
    const data = (await res.json()) as NimToolResponse;
    recordSuccess(circuitKey);
    return data;
  } catch (err) {
    recordFailure(circuitKey);
    throw err;
  }
}
