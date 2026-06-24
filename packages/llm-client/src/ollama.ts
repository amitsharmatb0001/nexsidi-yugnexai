import { canRequest, recordFailure, recordSuccess } from "./circuit-breaker.ts";
import type { ChatMessage } from "./types.ts";

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
