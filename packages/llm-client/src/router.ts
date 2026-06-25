import { nimChat } from "./nim.ts";
import { ollamaChat } from "./ollama.ts";
import { AGENT_MODELS, FALLBACK_CHAIN, type AgentName, type ChatMessage, type ModelId } from "./types.ts";
import { getState } from "./circuit-breaker.ts";

const OLLAMA_MODELS = new Set<ModelId>(["qwen2.5-coder:7b-instruct-q4_K_M"]);

// OLLAMA_ENABLED defaults to true locally; set to false on servers without a GPU.
// When false, Ollama entries in the fallback chain are silently skipped and NIM handles them.
const OLLAMA_ENABLED = process.env.OLLAMA_ENABLED !== "false";

async function callModel(model: ModelId, messages: ChatMessage[], apiKey: string): Promise<string> {
  if (OLLAMA_MODELS.has(model)) {
    if (!OLLAMA_ENABLED) throw new Error("Ollama disabled (OLLAMA_ENABLED=false) — falling back to NIM");
    const res = await ollamaChat(model, messages);
    return res.message.content;
  }
  const res = await nimChat(model, messages, apiKey);
  return res.choices[0]?.message.content ?? "";
}

// D14: 4-tier fallback — tries primary model, then each fallback in order
// D15: skips any model whose circuit breaker is OPEN
export async function agentChat(
  agentName: AgentName,
  messages: ChatMessage[],
  apiKey: string,
): Promise<{ content: string; modelUsed: ModelId }> {
  const chain = FALLBACK_CHAIN[agentName];
  const errors: string[] = [];

  for (const model of chain) {
    const circuitKey = OLLAMA_MODELS.has(model) ? `ollama:${model}` : `nim:${model}`;
    if (getState(circuitKey) === "OPEN") continue;

    try {
      const content = await callModel(model, messages, apiKey);
      return { content, modelUsed: model };
    } catch (err) {
      errors.push(`${model}: ${String(err)}`);
    }
  }

  const primary = AGENT_MODELS[agentName];
  throw new Error(
    `[llm-client] All fallbacks exhausted for ${agentName} (primary: ${primary})\n${errors.join("\n")}`,
  );
}
