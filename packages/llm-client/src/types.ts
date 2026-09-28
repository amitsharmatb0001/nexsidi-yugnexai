export type AgentName =
  | "tilotma" | "saanvi" | "arjun"
  | "vanya"   | "aanya"  | "shubham" | "pranav" | "aarav" | "riya"
  | "navya"   | "karan"  | "deepika"
  | "neha";

// 2026-09-28: live check (chat + tool call, direct to NIM, 60s limit) of every
// NIM model NexSidi was configured with — NONE could serve a single call, yet
// every agent tried them first. Retired from all live configuration (Amit's
// call); kept here only as a record, and loop.ts's sanitizeModelChain drops
// any of them that still appears in a chain.
// Working on this account on 2026-09-28 (NOT configured — add deliberately if
// wanted): nvidia/nemotron-3-super-120b-a12b, nvidia/nemotron-3-ultra-550b-a55b.
// Timing out that day: deepseek-ai/deepseek-v4.1-flash, moonshotai/kimi-k3,
// z-ai/glm-5.3, z-ai/glm-5.3-flash, openai/gpt-oss-20b.
export const RETIRED_NIM_MODELS: Record<string, string> = {
  "moonshotai/kimi-k2.6":              "404 Not Found for this account (2026-09-28)",
  "qwen/qwen3-next-80b-a3b-instruct":  "410 Gone — end of life 2026-07-27",
  "mistralai/mistral-nemotron":        "410 Gone — end of life 2026-09-28",
  "mistralai/mistral-medium-3.5-128b": "410 Gone — end of life 2026-08-07",
  "z-ai/glm-5.2":                      "410 Gone — end of life 2026-08-21",
};

export type ModelId =
  | "qwen2.5-coder:7b-instruct-q4_K_M"
  // 2026-07-08: QA_TIER=gemini routes Navya/Karan/Deepika through Gemini —
  // see router.ts's shouldUseGeminiForQA. Not a NIM/Ollama model, but
  // agentChat's return type (modelUsed: ModelId) needs a real member to
  // report it accurately instead of lying about which model actually ran.
  | "gemini-3.5-flash"
  // 2026-07-23: Gemini tier pool models for routeWithFallback() —
  // qa tier (unlimited thinking), generation tier (medium thinking),
  // user tier (minimal thinking / cheapest).
  | "gemini-3.1-pro-preview"
  | "gemini-3.6-flash"
  // 2026-08-16: same price as gemini-3.6-flash per Google's own docs.
  | "gemini-3.7-flash"
  // 2026-09-28: verified live on the aiayug project (global; 404 in
  // asia-southeast1). Same published price as 3.6/3.7-flash.
  | "gemini-3.8-flash"
  | "gemini-2.5-flash-lite";

// 2026-09-28: every agent whose primary was a (now retired) NIM model. Gemini
// is what actually served these agents in every recent build; naming it here
// makes that deliberate instead of a silent fallback. claude-loop.ts's
// runAgentEscalated sends an agent with no NIM model straight to its
// provider (Gemini, or Claude when CLAUDE_ENABLED=true).
export const DEFAULT_AGENT_MODEL: ModelId = "gemini-3.8-flash";
const OLLAMA_MODEL: ModelId = "qwen2.5-coder:7b-instruct-q4_K_M";

// Per-agent primary model assignment (D4). Ollama agents keep the local model
// for agentChat (router.ts), which calls Ollama directly.
export const AGENT_MODELS: Record<AgentName, ModelId> = {
  tilotma: DEFAULT_AGENT_MODEL,
  aanya:   DEFAULT_AGENT_MODEL,
  shubham: DEFAULT_AGENT_MODEL,
  saanvi:  DEFAULT_AGENT_MODEL,
  deepika: DEFAULT_AGENT_MODEL,
  arjun:   DEFAULT_AGENT_MODEL,
  navya:   DEFAULT_AGENT_MODEL,
  karan:   DEFAULT_AGENT_MODEL,
  vanya:   OLLAMA_MODEL,
  pranav:  OLLAMA_MODEL,
  aarav:   OLLAMA_MODEL,
  riya:    OLLAMA_MODEL,
  neha:    DEFAULT_AGENT_MODEL,
};

// Fix #2: RPM is per-model globally, NOT per-agent. 2026-09-28: emptied —
// every NIM model listed here was retired (see RETIRED_NIM_MODELS). Add an
// entry when a working NIM model is deliberately configured again.
export const MODEL_RPM_LIMITS: Record<string, number> = {};

// Fix #10: NIM free-tier context cap. 2026-09-28: emptied, same reason.
export const NIM_CONTEXT_LIMITS: Record<string, number> = {};

// D14 fallback chain per agent, used by router.ts's agentChat. 2026-09-28:
// every NIM entry retired; an empty chain means agentChat goes straight to
// Gemini. Ollama agents keep their local model.
export const FALLBACK_CHAIN: Record<AgentName, ModelId[]> = {
  tilotma: [],
  aanya:   [],
  shubham: [],
  saanvi:  [],
  deepika: [],
  arjun:   [],
  navya:   [],
  karan:   [],
  vanya:   [OLLAMA_MODEL],
  pranav:  [OLLAMA_MODEL],
  aarav:   [OLLAMA_MODEL],
  riya:    [OLLAMA_MODEL],
  neha:    [],
};

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
