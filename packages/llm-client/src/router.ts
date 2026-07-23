import { nimChat } from "./nim.ts";
import { ollamaChat } from "./ollama.ts";
import { geminiChat } from "./gemini.ts";
import { AGENT_MODELS, FALLBACK_CHAIN, type AgentName, type ChatMessage, type ModelId } from "./types.ts";
import { getState } from "./circuit-breaker.ts";

const OLLAMA_MODELS = new Set<ModelId>(["qwen2.5-coder:7b-instruct-q4_K_M"]);

// 2026-07-08: root-caused why a Gemini-primary generation run still took
// 6.5 hours despite generation finishing in minutes — Navya/Karan/Deepika's
// QA reviews are ~80,000-input-token calls (the full generated codebase as
// text) and were STILL routed through NIM's free/slow tier via agentChat's
// fixed FALLBACK_CHAIN, completely unaffected by GENERATOR_TIER=gemini
// (which only touches Shubham/Aanya's tool-calling loop). QA_TIER=gemini
// routes these specific three agents through Gemini too — scoped to QA
// only so non-QA agents (Saanvi, Arjun, ...) keep using their existing NIM
// chains even when QA_TIER is set.
const QA_AGENTS = new Set<AgentName>(["navya", "karan", "deepika"]);

export function shouldUseGeminiForQA(agentName: AgentName): boolean {
  return process.env.QA_TIER === "gemini" && QA_AGENTS.has(agentName);
}

// OLLAMA_ENABLED defaults to true locally; set to false on servers without a GPU.
// When false, Ollama entries in the fallback chain are silently skipped and NIM handles them.
const OLLAMA_ENABLED = process.env.OLLAMA_ENABLED !== "false";

async function callModel(
  model: ModelId,
  messages: ChatMessage[],
  apiKey: string,
  maxTokens?: number,
): Promise<string> {
  if (OLLAMA_MODELS.has(model)) {
    if (!OLLAMA_ENABLED) throw new Error("Ollama disabled (OLLAMA_ENABLED=false) — falling back to NIM");
    const res = await ollamaChat(model, messages);
    return res.message.content;
  }
  const res = await nimChat(model, messages, apiKey, maxTokens);
  return res.choices[0]?.message.content ?? "";
}

// D14: 4-tier fallback — tries primary model, then each fallback in order
// D15: skips any model whose circuit breaker is OPEN
export async function agentChat(
  agentName: AgentName,
  messages: ChatMessage[],
  apiKey: string,
  opts?: { maxTokens?: number },
): Promise<{ content: string; modelUsed: ModelId }> {
  if (shouldUseGeminiForQA(agentName)) {
    const { content } = await geminiChat(messages, { maxTokens: opts?.maxTokens });
    return { content, modelUsed: "gemini-3.5-flash" };
  }

  const chain = FALLBACK_CHAIN[agentName];
  const errors: string[] = [];

  for (const model of chain) {
    const circuitKey = OLLAMA_MODELS.has(model) ? `ollama:${model}` : `nim:${model}`;
    if (getState(circuitKey) === "OPEN") continue;

    try {
      const content = await callModel(model, messages, apiKey, opts?.maxTokens);
      // T3 (full-system audit): agentChat returned modelUsed but no caller
      // logged it — impossible to tell from the outside whether an agent
      // ran on its primary model or silently fell through the chain (e.g.
      // Arjun's primary was marked "❌ timeout" in a stale comment in
      // types.ts while still being AGENT_MODELS.arjun — this log line is
      // what would have surfaced that instead of it going unnoticed).
      if (model !== chain[0]) {
        console.log(`[agentChat:${agentName}] used fallback model ${model} (primary ${chain[0]} failed)`);
      }
      return { content, modelUsed: model };
    } catch (err) {
      errors.push(`${model}: ${String(err)}`);
    }
  }

  // Last-resort: Gemini when all NIM models are unreachable (network outage, rate limits)
  try {
    console.log(`[agentChat:${agentName}] NIM fully exhausted — using Gemini last-resort`);
    const { content } = await geminiChat(messages, { maxTokens: opts?.maxTokens });
    return { content, modelUsed: "gemini-3.5-flash" };
  } catch (geminiErr) {
    errors.push(`gemini-3.5-flash: ${String(geminiErr)}`);
  }

  const primary = AGENT_MODELS[agentName];
  throw new Error(
    `[llm-client] All fallbacks exhausted for ${agentName} (primary: ${primary})\n${errors.join("\n")}`,
  );
}

// ── Tiered Gemini pool routing with zero-wait 429 switching ──────────────────
//
// Three tiers: "qa" (unlimited thinking — thinking_level:HIGH),
// "generation" (medium thinking), "user" (minimal thinking, cheapest).
// On ANY failure (429, network error, etc.) → immediately try next model in
// pool with NO sleep/backoff. NIM is not involved.

type GeminiTier = "qa" | "generation" | "user";

const TIER_POOLS: Record<GeminiTier, string[]> = {
  qa:         ["gemini-3.1-pro-preview", "gemini-3.6-flash", "gemini-3.5-flash"],
  generation: ["gemini-3.6-flash", "gemini-3.5-flash"],
  user:       ["gemini-2.5-flash-lite", "gemini-3.5-flash"],
};

const TIER_THINKING_BUDGET: Record<GeminiTier, number> = {
  qa:         -1,    // unlimited — thinking_level:HIGH
  generation: 8192,  // medium thinking
  user:       1024,  // minimal thinking, cheapest
};

export async function routeWithFallback(
  tier: GeminiTier,
  messages: ChatMessage[],
  opts?: { maxTokens?: number },
): Promise<{ content: string; modelUsed: string }> {
  const pool = TIER_POOLS[tier];
  const thinkingBudget = TIER_THINKING_BUDGET[tier];
  const errors: string[] = [];

  for (const model of pool) {
    try {
      const { content } = await geminiChat(messages, {
        model,
        maxTokens: opts?.maxTokens,
        thinkingBudget,
      });
      if (model !== pool[0]) {
        console.log(`[routeWithFallback:${tier}] used fallback model ${model} (pool[0]=${pool[0]} failed)`);
      }
      return { content, modelUsed: model };
    } catch (err) {
      errors.push(`${model}: ${String(err)}`);
      // Zero-wait: immediately try next model, no sleep/backoff
    }
  }

  throw new Error(
    `[llm-client] routeWithFallback(${tier}) — all pool models exhausted:\n${errors.join("\n")}`,
  );
}
