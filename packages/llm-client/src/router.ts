import { nimChat } from "./nim.ts";
import { ollamaChat } from "./ollama.ts";
import { geminiChat, geminiChatWithTools, circuitKeyFor, type GeminiMessage, type GeminiToolDef, type GeminiChatWithToolsResult, type GeminiThinkingLevel } from "./gemini.ts";
import { AGENT_MODELS, FALLBACK_CHAIN, type AgentName, type ChatMessage, type ModelId, OLLAMA_MODELS, isNimEnabled } from "./types.ts";
import { getState } from "./circuit-breaker.ts";
import { isNimOnlyAgent, routeToolsViaNim, chatViaNim } from "./nim-only.ts";
import { isProviderRefusal, ProviderRefusalError } from "./provider-refusal.ts";

// 2026-09-28: OLLAMA_MODELS now lives in types.ts (one registry for every model name).

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
  // 2026-10-21: the plan that decides what gets built is the hardest reasoning in the pipeline and everything after depends on it.
  return agentName === "saanvi" || agentName === "arjun" ? "critical" : "generation";
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
  // 2026-10-23: agents kept off Gemini on purpose (nim-only.ts) go to NVIDIA first and never fall back to Gemini.
  if (isNimOnlyAgent(agentName)) return chatViaNim(agentName, messages, opts);
  if (shouldUseGeminiForPipeline(agentName)) {
    const { content, modelUsed } = await routeWithFallback(pipelineTierFor(agentName), messages, opts);
    return { content, modelUsed: modelUsed as ModelId };
  }

  if (shouldUseGeminiForQA(agentName)) {
    const { content } = await geminiChat(messages, { maxTokens: opts?.maxTokens });
    return { content, modelUsed: "gemini-3.5-flash" };
  }

  // NIM_ENABLED=false keeps only local Ollama entries (types.ts isNimEnabled).
  const chain = isNimEnabled() ? FALLBACK_CHAIN[agentName] : FALLBACK_CHAIN[agentName].filter((m) => OLLAMA_MODELS.has(m));
  const errors: string[] = [];

  // 2026-09-28: every NIM model was retired (types.ts RETIRED_NIM_MODELS), so
  // most chains are empty on purpose — Gemini is the configured path, not a
  // last resort.
  if (chain.length === 0) {
    const { content } = await geminiChat(messages, { maxTokens: opts?.maxTokens });
    return { content, modelUsed: "gemini-3.5-flash" };
  }

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

export type GeminiTier = "plan" | "design" | "qa" | "generation" | "a2a" | "user" | "critical";

// 2026-08-09: real gap found live, TWICE (project meridianbk1, meridianbk2)
// — "design" was the ONLY tier missing gemini-3.5-flash as a fallback.
// Confirmed both times: when gemini-3.1-pro-preview AND gemini-3.6-flash
// were both circuit-broken simultaneously, Aanya's integration call had
// ZERO remaining option and killed the whole workflow — while every other
// tier (plan/qa above, generation below) already includes 3.5-flash as
// exactly this kind of last-resort fallback, and it's been the single most
// reliably-available model across this entire session's live testing.
// Appending it here doesn't change the deliberate pro-model-first ordering
// (design still leads with 3.1-pro-preview for quality, see the comment on
// Aanya's geminiTier config) — it only adds a third rung so a fully-
// exhausted pool degrades to "finish with a lesser model" instead of
// "fail the entire pipeline."
// 2026-08-16: gemini-3.7-flash added ahead of gemini-3.6-flash in every
// Flash-tier slot — same price as 3.6-flash per Google's own docs, better
// agentic-task performance, no reason to prefer the older model once 3.7 is
// available. 3.6-flash kept immediately after it (not removed) as a live
// fallback: 3.6-flash itself had a real region-availability gap on the new
// aiayug project tonight (404 in asia-southeast1), so a brand-new model
// could plausibly have a similar gap on a fresh project — this degrades
// gracefully instead of assuming untested full parity.
// 2026-09-28: gemini-3.8-flash added ahead of 3.7-flash in every Flash slot
// (Amit's request). Same published price as 3.6/3.7 flash
// (ai.google.dev/gemini-api/docs/pricing). Verified live on this project:
// answers on "global", 404 on asia-southeast1 — so a global 429 that falls
// back to that region fails over to the next model here, exactly like
// 3.6-flash's earlier regional gap. Every model listed here MUST also be in
// cost-budget.ts's PRICING (enforced by cost-budget.test.ts) — 3.7-flash
// wasn't, and was billed at the Opus fallback rate for six weeks.
// 2026-10-21: gemini-4-argon (general release 2026-10-13; 1M tokens in and out; text output; model card at gemini-4-argon.md) leads a
// new "critical" tier, used only for the hardest reasoning work: the plan that decides what gets built (Saanvi, Arjun), the final
// reality check, and settling disputes between a reviewer and a builder. Behind it sit the models already proven in this pool, in the
// same order as the "plan" tier, so an argon that is unavailable, over quota, or fails answers by moving straight to the next one.
// Not yet run live: the Google projects configured here had billing disabled on 2026-10-21, so the model has not been called from
// this code. GEMINI_CRITICAL_ARGON=off removes it from the pool without a code change; scripts/probe-gemini-model.ts checks it first.
const CRITICAL_FALLBACKS = ["gemini-3.1-pro-preview", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"];
const ARGON = "gemini-4-argon";

const TIER_POOLS: Record<GeminiTier, string[]> = {
  critical:   [ARGON, ...CRITICAL_FALLBACKS],
  plan:       ["gemini-3.1-pro-preview", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"],
  design:     ["gemini-3.1-pro-preview", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"],
  qa:         ["gemini-3.1-pro-preview", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"],
  generation: ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"],
  a2a:        ["gemini-2.5-flash-lite", "gemini-3.5-flash"],
  user:       ["gemini-2.5-flash-lite", "gemini-3.5-flash"],
};

const TIER_THINKING_LEVEL: Record<GeminiTier, GeminiThinkingLevel> = {
  critical:   "HIGH",
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
  if (explicitModel) return [explicitModel];
  const pool = TIER_POOLS[tier];
  // The switch is read on every call, so it can be changed without a restart of the code that calls this.
  return process.env.GEMINI_CRITICAL_ARGON === "off" ? pool.filter((m) => m !== ARGON) : pool;
}

/** Every model any tier pool can pick, once each — what the spend table must price. */
export function allPoolModels(): string[] {
  return [...new Set(Object.values(TIER_POOLS).flat())];
}

export function thinkingLevelForTier(tier: GeminiTier): GeminiThinkingLevel {
  return TIER_THINKING_LEVEL[tier];
}

// 2026-07-28: real bug found live — Navya/Karan/Deepika (meant to run in
// genuine parallel, per CLAUDE.md's own stated design: "Same model = 40 RPM
// rate limit collision. Different models = 120 RPM effective capacity") all
// called routeToolsWithFallback("qa", ...) with the IDENTICAL pool in the
// IDENTICAL order. With gemini-3.1-pro-preview (pool[0]) exhausted for an
// entire live run, all three agents collided on the SAME fallback model's
// shared 50 RPM token bucket (waitForToken is keyed by model name, not by
// agent) — exactly the collision CLAUDE.md's own architecture was designed
// to avoid, just lost when QA routing moved from per-agent NIM models to a
// single shared Gemini tier pool. Rotating each agent's FALLBACK order
// (keeping the same pro-tier model first for quality) spreads the 3 agents
// across the 2 available fallback models instead of all queueing on one.
// Deterministic (not random) so behavior is reproducible and testable.
function stringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h ^ (h << 5) ^ (h >> 2) ^ s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// 2026-10-24 (Amit: "separate all agents to separate models so they do their work parallel"): agents that run at the same
// time each start on their own model, taken in the tier's own order (so a reordered pool moves them too). The three
// reviewers run together; the two builders are on different tiers already. A sub-check ("karan-subcheck") follows its
// parent. Every model stays in the pool as a fallback.
const PARALLEL_FIRST_MODEL_INDEX: Record<string, number> = { navya: 0, karan: 1, deepika: 2 };

export function rotatedPoolForAgent(tier: GeminiTier, agentName: string): string[] {
  const pool = poolForTier(tier);
  if (pool.length <= 2) return pool; // nothing to rotate among

  const index = PARALLEL_FIRST_MODEL_INDEX[agentName.split("-")[0]!];
  const first = index !== undefined && index < pool.length ? pool[index]! : pool[0]!;
  const [primary, ...fallbacks] = [first, ...pool.filter((m) => m !== first)];
  const offset = stringHash(agentName) % fallbacks.length;
  const rotatedFallbacks = [...fallbacks.slice(offset), ...fallbacks.slice(0, offset)];
  return primary ? [primary, ...rotatedFallbacks] : rotatedFallbacks;
}

// 2026-07-28: mirrors the exact D15 pattern agentChat's NIM/Ollama chain
// already uses ("skips any model whose circuit breaker is OPEN") — the
// Gemini pool functions below didn't have it, so a pool call that hit an
// already-OPEN circuit for pool[0] still called into geminiChat/
// geminiChatWithTools, which then invoked waitForCircuit and BLOCKED for up
// to OPEN_TIMEOUT_MS (60s) waiting out the cooldown before even attempting
// a HALF_OPEN probe — on every single call, while a working fallback model
// was one line away the whole time. Skipping here means the loop moves to
// the next pool model immediately instead of paying that wait.
// 2026-08-28: real waste measured live (project 852be5aeaef4).
// gemini-3.1-pro-preview sits at pool[0] for the plan/design/qa tiers. Across
// that run it SUCCEEDED 70 times and FAILED as pool[0] 105 times — a 40%
// success rate — so ~60% of calls to those tiers burned a full network
// round-trip on a model that was rate-limited before falling back to one that
// worked. The circuit breaker did not help: it opened only twice all run,
// because a 429 is correctly classified as transient and deliberately does
// NOT trip it (a rate limit is not a broken endpoint, and tripping the
// breaker would take the model out for a full 60s OPEN_TIMEOUT_MS).
//
// The gap is that "transient" was treated as "retry immediately on the very
// next call", so the same rate-limited model was re-attempted 105 times. A
// short cooldown is the missing middle ground: after a 429, skip that model
// for a few seconds so the pool moves straight to a working one, while still
// bringing it back quickly (unlike the breaker's 60s) because rate limits
// refill continuously. This costs no waiting anywhere — it only reorders
// which model is tried FIRST.
const RATE_LIMIT_COOLDOWN_MS = 20_000;
const rateLimitedUntil = new Map<string, number>();

/** Called on a 429 so the pool stops leading with a model that is currently throttled. */
export function noteGeminiRateLimited(model: string, now = Date.now()): void {
  rateLimitedUntil.set(model, now + RATE_LIMIT_COOLDOWN_MS);
}

// 2026-10-23 (Brewline test build): on project ai-ns-yug gemini-3.8-flash answered 0 of 4 calls, each hanging until the
// 120 s timeout (8 minutes lost in 30). A model that times out is skipped for 10 minutes, then tried again.
const UNRESPONSIVE_COOLDOWN_MS = 10 * 60_000;
export function noteGeminiUnresponsive(model: string, now = Date.now()): void {
  rateLimitedUntil.set(model, now + UNRESPONSIVE_COOLDOWN_MS);
}

/** Exported for tests — clears cooldown state between cases. */
export function clearGeminiRateLimitCooldowns(): void {
  rateLimitedUntil.clear();
}

export function isGeminiRateLimitCoolingDown(model: string, now = Date.now()): boolean {
  const until = rateLimitedUntil.get(model);
  if (until === undefined) return false;
  if (now >= until) {
    rateLimitedUntil.delete(model); // expired — let it back in
    return false;
  }
  return true;
}

export function shouldSkipGeminiModel(model: string): boolean {
  return getState(circuitKeyFor(model)) === "OPEN" || isGeminiRateLimitCoolingDown(model);
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
    if (shouldSkipGeminiModel(model)) {
      errors.push(`${model}: circuit breaker OPEN — skipped`);
      continue;
    }
    try {
      const { content } = await geminiChat(messages, {
        model,
        maxTokens: opts?.maxTokens,
        thinkingLevel,
        // 2026-07-28: this loop already promises "zero-wait... no sleep/
        // backoff" below — but geminiChat's own internal retry paid up to
        // ~35s of local backoff on a 429 BEFORE that promise ever took
        // effect, on every failed pool model. fastFailOn429 closes that gap:
        // a guaranteed fallback is one line away, so there's no reason to
        // retry locally first.
        fastFailOn429: true,
      });
      if (model !== pool[0]) {
        console.log(`[routeWithFallback:${tier}] used fallback model ${model} (pool[0]=${pool[0]} failed)`);
      }
      return { content, modelUsed: model };
    } catch (err) {
      // 2026-10-23: a terms-of-use refusal is not sent to any other model (provider-refusal.ts).
      if (isProviderRefusal(String(err))) throw new ProviderRefusalError(String(err));
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
  opts?: { model?: string; cachedContent?: string; agentName?: string },
  deps: { chat?: typeof geminiChatWithTools } = {},
): Promise<GeminiChatWithToolsResult & { modelUsed: string }> {
  // 2026-10-23: agents kept off Gemini on purpose (nim-only.ts) go to NVIDIA and never reach the Gemini pool.
  if (isNimOnlyAgent(opts?.agentName)) return routeToolsViaNim(messages, tools, opts!.agentName!);
  const chat = deps.chat ?? geminiChatWithTools;
  // 2026-07-28: opts.agentName rotates the FALLBACK order (see
  // rotatedPoolForAgent's header comment) so parallel callers sharing one
  // tier (Navya/Karan/Deepika all on "qa") don't all collide on the same
  // fallback model's rate limit when the shared primary is exhausted.
  // opts.model still takes precedence when set (collapses to one model,
  // existing override semantics unchanged).
  const pool = opts?.model
    ? poolForTier(tier, opts.model)
    : opts?.agentName
      ? rotatedPoolForAgent(tier, opts.agentName)
      : poolForTier(tier);
  const thinkingLevel = thinkingLevelForTier(tier);
  const errors: string[] = [];

  // 2026-08-28: two-pass so a rate-limit cooldown can NEVER make the pool
  // empty. Pass 1 tries only models that are not cooling down (the whole
  // point — stop leading with a model that just 429'd). Pass 2 retries the
  // skipped ones anyway, because a cooldown is an optimization, not a
  // capacity limit: if every model is cooling down we must still attempt the
  // call rather than fail with "all exhausted" while quota may well be
  // available again. See noteGeminiRateLimited for the measured waste.
  const ready = pool.filter((m) => !shouldSkipGeminiModel(m));
  const deferred = pool.filter((m) => !ready.includes(m));
  const attemptOrder = [...ready, ...deferred];
  if (ready.length === 0 && pool.length > 0) {
    console.log(`[routeToolsWithFallback:${tier}] every pool model is cooling down or circuit-open — attempting anyway rather than failing without trying`);
  }

  let lastEmpty: (GeminiChatWithToolsResult & { modelUsed: string }) | null = null;
  for (const model of attemptOrder) {
    // 2026-10-22: every attempt's time and outcome is logged — a one-pass review took 525 s for 2 calls, and nearly every
    // call in a build said "pool[0] failed" with no reason or duration, so the time could not be traced to anything.
    const startedAt = Date.now();
    const took = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    try {
      const result = await chat(messages, tools, {
        model,
        thinkingLevel,
        cachedContent: opts?.cachedContent,
        // 2026-07-28: same reasoning as routeWithFallback above — a
        // guaranteed fallback model is one line away in this loop.
        fastFailOn429: true,
      });
      console.log(`[call-time:${tier}] ${opts?.agentName ?? "?"} ${model} ok in ${took()}`);
      // An answer with no text and no tool call is a failed call, not a turn (Shopbill run 4: three in a row ended
      // a whole pass having written nothing). Try the next model, as for an error.
      if (result.toolCalls.length === 0 && !result.content?.trim()) {
        console.log(`[routeToolsWithFallback:${tier}] ${model} answered with nothing — trying the next model`);
        errors.push(`${model}: empty answer`);
        lastEmpty = { ...result, modelUsed: model };
        continue;
      }
      if (model !== pool[0]) {
        console.log(`[routeToolsWithFallback:${tier}] used fallback model ${model} (pool[0]=${pool[0]} failed)`);
      }
      return { ...result, modelUsed: model };
    } catch (err) {
      const msg = String(err);
      console.log(`[call-time:${tier}] ${opts?.agentName ?? "?"} ${model} FAILED in ${took()}: ${msg.replace(/\s+/g, " ").slice(0, 160)}`);
      // 2026-10-23: a terms-of-use refusal is not sent to any other model, and nothing retries it (provider-refusal.ts).
      if (isProviderRefusal(msg)) throw new ProviderRefusalError(msg);
      // Record the throttle so the NEXT call in this run leads with a model
      // that is actually available, instead of repeating this round-trip.
      if (msg.includes("429") || /rate.?limit|RESOURCE_EXHAUSTED/i.test(msg)) {
        noteGeminiRateLimited(model);
      } else if (/AbortError|operation was aborted|timed out/i.test(msg)) {
        noteGeminiUnresponsive(model);
      }
      errors.push(`${model}: ${msg}`);
      // Zero-wait: immediately try next model, no sleep/backoff
    }
  }

  // Every model that answered at all answered with nothing: hand that back, so the caller's own handling
  // (nudge, then give up) runs, instead of reporting a provider outage that did not happen.
  if (lastEmpty) return lastEmpty;

  throw new Error(
    `[llm-client] routeToolsWithFallback(${tier}) — all pool models exhausted:\n${errors.join("\n")}`,
  );
}
