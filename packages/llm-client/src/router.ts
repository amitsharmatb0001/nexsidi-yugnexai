import { nimChat } from "./nim.ts";
import { ollamaChat } from "./ollama.ts";
import { geminiChat, geminiChatWithTools, type GeminiMessage, type GeminiToolDef, type GeminiChatWithToolsResult, type GeminiThinkingLevel } from "./gemini.ts";
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

// 2026-07-23: NIM is unreachable on this machine — every agentChat call for
// Saanvi/Arjun/Pranav/Riya burns through the full NIM fallback chain (~4 models
// × up to 240s each) before hitting the Gemini last-resort. PIPELINE_TIER=gemini
// routes these agents directly to routeWithFallback("generation") — zero NIM
// contact, zero wait. Shubham/Aanya already use geminiChatWithTools directly.
const PIPELINE_AGENTS = new Set<AgentName>(["saanvi", "arjun", "pranav", "riya"]);

export function shouldUseGeminiForPipeline(agentName: AgentName): boolean {
  return process.env.PIPELINE_TIER === "gemini" && PIPELINE_AGENTS.has(agentName);
}

// 2026-07-25 (Phase 1, found LIVE mid-run on nextech10): this is the SECOND
// planner-tier bug, distinct from the one already fixed in
// agents/planner/src/index.ts. That fix only touched the interactive
// elicitation chat agent; Arjun (agents/arjun/src/index.ts) — the agent that
// actually builds the BuildPlan/file manifest for a Temporal-driven run via
// agentChat below — was still hardcoded to "generation" regardless of role,
// same root cause as the planner bug. Confirmed live: nextech10's Saanvi and
// Arjun calls both logged `[gemini:gemini-3.6-flash]` before this landed.
// Saanvi and Arjun decide WHAT gets built (spec + file manifest); Pranav and
// Riya execute a decision already made (migrations, deploy config) — so
// only the first two move to the pro-tier "plan" pool.
export function pipelineTierFor(agentName: AgentName): GeminiTier {
  return agentName === "saanvi" || agentName === "arjun" ? "plan" : "generation";
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
  if (shouldUseGeminiForPipeline(agentName)) {
    const { content, modelUsed } = await routeWithFallback(pipelineTierFor(agentName), messages, opts);
    return { content, modelUsed: modelUsed as ModelId };
  }

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
// 2026-07-25 (Phase 1, full MVP upgrade): six tiers, not three. Verified live
// against the running DB and source (.nexsidi/sdd/audit-2026-07-25.md, A.3):
// the planner ran on "user" (flash-lite, the cheapest model) and decided the
// page/file manifest — the direct cause of nextech8 shipping without its
// requested Vision/Mission pages. "plan" and "design" now get the same
// pro-tier pool as "qa"; only high-volume boilerplate ("generation") and
// literal chat/status ("user") stay cheap. "a2a" is new: agent-to-agent
// coordination (handoff summaries, status pings, contract-clarity checks) —
// high volume, low reasoning need, kept off the reasoning tiers entirely so
// coordination chatter never competes with them for latency or budget.
//
// thinking_level replaces the legacy thinking_budget integer on Gemini 3.x —
// sending both in one request is a 400 (gemini_3_1_pro.md / _3_5_flash.md /
// _3_6_flash.md, all read in full). See buildThinkingConfig in gemini.ts.
//
// On ANY failure (429, network error, etc.) → immediately try next model in
// pool with NO sleep/backoff. NIM is not involved.

export type GeminiTier = "plan" | "design" | "qa" | "generation" | "a2a" | "user";

const TIER_POOLS: Record<GeminiTier, string[]> = {
  plan:       ["gemini-3.1-pro-preview", "gemini-3.6-flash", "gemini-3.5-flash"],
  design:     ["gemini-3.1-pro-preview", "gemini-3.6-flash"],
  qa:         ["gemini-3.1-pro-preview", "gemini-3.6-flash", "gemini-3.5-flash"],
  generation: ["gemini-3.6-flash", "gemini-3.5-flash"],
  a2a:        ["gemini-2.5-flash-lite", "gemini-3.5-flash"],
  user:       ["gemini-2.5-flash-lite", "gemini-3.5-flash"],
};

const TIER_THINKING_LEVEL: Record<GeminiTier, GeminiThinkingLevel> = {
  plan:       "HIGH",
  design:     "HIGH",
  qa:         "HIGH",
  generation: "MEDIUM",
  a2a:        "LOW",
  user:       "LOW",
};

// 2026-07-24 (W0.2, full agentic upgrade): pure decision function extracted
// so the pool-selection logic is unit-testable without a network call —
// matches this file's existing convention (shouldUseGeminiForQA is tested,
// the network call it gates is not). An explicit `explicitModel` (e.g. a
// caller-set GEMINI_GENERATION_MODEL override) collapses the pool to that
// one model — no fallback — preserving today's override semantics; leaving
// it unset uses the full tier pool with zero-wait fallback.
export function poolForTier(tier: GeminiTier, explicitModel?: string): string[] {
  return explicitModel ? [explicitModel] : TIER_POOLS[tier];
}

export function thinkingLevelForTier(tier: GeminiTier): GeminiThinkingLevel {
  return TIER_THINKING_LEVEL[tier];
}

export async function routeWithFallback(
  tier: GeminiTier,
  messages: ChatMessage[],
  opts?: { maxTokens?: number },
): Promise<{ content: string; modelUsed: string }> {
  const pool = poolForTier(tier);
  const thinkingLevel = thinkingLevelForTier(tier);
  const errors: string[] = [];

  for (const model of pool) {
    try {
      const { content } = await geminiChat(messages, {
        model,
        maxTokens: opts?.maxTokens,
        thinkingLevel,
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

// 2026-07-24 (W0.2, full agentic upgrade): the tool-calling counterpart to
// routeWithFallback — routeWithFallback only drives geminiChat (one-shot,
// no tools), so it was structurally unable to serve qa-loop.ts's/
// gemini-loop.ts's tool-calling agent loops. Those loops previously called
// geminiChatWithTools(messages, tools) with NO model/tier resolution at
// all, silently defaulting to gemini-3.5-flash regardless of the qa/
// generation TIER_POOLS defined above — this is the function that actually
// activates them. Same zero-wait pool-switching contract as
// routeWithFallback: on ANY failure, try the next model in the pool
// immediately, no sleep/backoff.
export async function routeToolsWithFallback(
  tier: GeminiTier,
  messages: GeminiMessage[],
  tools: GeminiToolDef[],
  opts?: { model?: string; cachedContent?: string },
): Promise<GeminiChatWithToolsResult & { modelUsed: string }> {
  const pool = poolForTier(tier, opts?.model);
  const thinkingLevel = thinkingLevelForTier(tier);
  const errors: string[] = [];

  for (const model of pool) {
    try {
      const result = await geminiChatWithTools(messages, tools, { model, thinkingLevel, cachedContent: opts?.cachedContent });
      if (model !== pool[0]) {
        console.log(`[routeToolsWithFallback:${tier}] used fallback model ${model} (pool[0]=${pool[0]} failed)`);
      }
      return { ...result, modelUsed: model };
    } catch (err) {
      errors.push(`${model}: ${String(err)}`);
      // Zero-wait: immediately try next model, no sleep/backoff
    }
  }

  throw new Error(
    `[llm-client] routeToolsWithFallback(${tier}) — all pool models exhausted:\n${errors.join("\n")}`,
  );
}
