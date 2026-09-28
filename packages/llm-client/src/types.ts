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
export const RETIRED_NIM_MODELS: Record<string, string> = {
  "moonshotai/kimi-k2.6":              "404 Not Found for this account (2026-09-28)",
  "qwen/qwen3-next-80b-a3b-instruct":  "410 Gone — end of life 2026-07-27",
  "mistralai/mistral-nemotron":        "410 Gone — end of life 2026-09-28",
  "mistralai/mistral-medium-3.5-128b": "410 Gone — end of life 2026-08-07",
  "z-ai/glm-5.2":                      "410 Gone — end of life 2026-08-21",
};

// 2026-09-28: the NIM catalogue was evaluated live (2 chats, 1 tool call and
// a coding task run against 8 tests, 150s limit per call). Active = passed:
//   meta/muse-glimmer-30b              chat 7s/15s, tools 2.7s, coding 8/8 in 41s
//   nvidia/nemotron-3-ultra-550b-a55b  tools 3.8s, coding 8/8 in 104s, one 503
// Not used: deepseek-v4.1-flash, glm-5.3-flash, nemotron-3.5-lightning (1-2
// min per short reply, coding timed out), kimi-k3 and glm-5.3 (no answer in
// 150s), nemotron-3-super (503 overloaded 3 of 4 calls). Free endpoints change
// hour to hour — re-run the evaluation before promoting anything.
export const ACTIVE_NIM_MODELS = ["meta/muse-glimmer-30b", "nvidia/nemotron-3-ultra-550b-a55b"] as const;

// Local Ollama models, recognised by exact name (they have no "provider/"
// prefix). OLLAMA_TOOL_MODELS lists the ones that can run an agent's tool
// loop — measured 2026-09-28: qwen2.5-coder:7b answered a tool-call prompt
// with plain text and scored 4/8 on the coding task, so it chats (router.ts
// agentChat) but is not used for tool work. Add a model here after pulling
// one that passes the same evaluation.
export const OLLAMA_MODELS: ReadonlySet<string> = new Set(["qwen2.5-coder:7b-instruct-q4_K_M"]);
export const OLLAMA_TOOL_MODELS: ReadonlySet<string> = new Set<string>();

export type ModelId =
  | (typeof ACTIVE_NIM_MODELS)[number]
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

const NIM_PRIMARY: ModelId = "meta/muse-glimmer-30b";
const NIM_CHAIN: ModelId[] = [...ACTIVE_NIM_MODELS];
const OLLAMA_MODEL: ModelId = "qwen2.5-coder:7b-instruct-q4_K_M";

// Per-agent primary model assignment (D4). NIM runs first where an agent uses
// the NIM path (claude-loop.ts runAgentEscalated / router.ts agentChat); its
// provider (Gemini, or Claude when CLAUDE_ENABLED=true) takes over on failure,
// and NIM_ENABLED=false skips NIM entirely. Ollama agents keep the local model
// first for plain chat.
export const AGENT_MODELS: Record<AgentName, ModelId> = {
  tilotma: NIM_PRIMARY,
  aanya:   NIM_PRIMARY,
  shubham: NIM_PRIMARY,
  saanvi:  NIM_PRIMARY,
  deepika: NIM_PRIMARY,
  arjun:   NIM_PRIMARY,
  navya:   NIM_PRIMARY,
  karan:   NIM_PRIMARY,
  vanya:   OLLAMA_MODEL,
  pranav:  OLLAMA_MODEL,
  aarav:   OLLAMA_MODEL,
  riya:    OLLAMA_MODEL,
  neha:    NIM_PRIMARY,
};

// Fix #2: RPM is per-model globally, NOT per-agent. 40 = NIM free-tier limit.
export const MODEL_RPM_LIMITS: Record<string, number> = {
  "meta/muse-glimmer-30b":             40,
  "nvidia/nemotron-3-ultra-550b-a55b": 40,
};

// Fix #10: NIM context caps. muse-glimmer: the API itself rejects
// max_tokens above 1,048,576 (measured 2026-09-28). nemotron-3-ultra reports
// no limit — conservative value until measured.
export const NIM_CONTEXT_LIMITS: Record<string, number> = {
  "meta/muse-glimmer-30b":             1_048_576,
  "nvidia/nemotron-3-ultra-550b-a55b": 131_072,
};

// D14 fallback chain per agent (router.ts agentChat, and the NIM chain the
// tool loop tries). Ollama entries are skipped for tool work (see
// OLLAMA_TOOL_MODELS) but still serve plain chat.
export const FALLBACK_CHAIN: Record<AgentName, ModelId[]> = {
  tilotma: NIM_CHAIN,
  aanya:   NIM_CHAIN,
  shubham: NIM_CHAIN,
  saanvi:  NIM_CHAIN,
  deepika: NIM_CHAIN,
  arjun:   NIM_CHAIN,
  navya:   NIM_CHAIN,
  karan:   NIM_CHAIN,
  vanya:   [OLLAMA_MODEL, ...NIM_CHAIN],
  pranav:  [OLLAMA_MODEL, ...NIM_CHAIN],
  aarav:   [OLLAMA_MODEL, ...NIM_CHAIN],
  riya:    [OLLAMA_MODEL, ...NIM_CHAIN],
  neha:    NIM_CHAIN,
};

// 2026-09-28 (Amit): NIM is free but 2-3x slower than Gemini — like Claude it
// is an env flag. NIM_ENABLED=false skips every NIM model (no code change);
// default on.
export function isNimEnabled(): boolean {
  return process.env.NIM_ENABLED !== "false";
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
