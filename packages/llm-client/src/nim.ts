import { canRequest, recordFailure, recordSuccess } from "./circuit-breaker.ts";
import { waitForToken } from "./token-bucket.ts";
import { MODEL_RPM_LIMITS, NIM_CONTEXT_LIMITS, type ChatMessage, type ModelId } from "./types.ts";

const NIM_BASE_URL = process.env.NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1";

export interface NimResponse {
  id: string;
  choices: Array<{ message: { content: string } }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function nimChat(
  modelId: ModelId,
  messages: ChatMessage[],
  apiKey: string,
): Promise<NimResponse> {
  const circuitKey = `nim:${modelId}`;
  if (!canRequest(circuitKey)) {
    throw new Error(`[llm-client] Circuit breaker OPEN for ${modelId} — all retries exhausted`);
  }

  const rpmLimit = MODEL_RPM_LIMITS[modelId] ?? 40;
  await waitForToken(modelId, rpmLimit);

  // Fix #10: use NIM free-tier context limit, not the model's theoretical max
  const contextLimit = NIM_CONTEXT_LIMITS[modelId] ?? 32768;
  const maxTokens = Math.min(4096, Math.floor(contextLimit * 0.75));

  try {
    const res = await fetch(`${NIM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: modelId, messages, max_tokens: maxTokens }),
    });

    if (!res.ok) {
      const body = await res.text();
      recordFailure(circuitKey);
      throw new Error(`[NIM ${res.status}] ${body}`);
    }

    const data = (await res.json()) as NimResponse;
    recordSuccess(circuitKey);
    return data;
  } catch (err) {
    recordFailure(circuitKey);
    throw err;
  }
}
