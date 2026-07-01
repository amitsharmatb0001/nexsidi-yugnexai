export type AgentName =
  | "tilotma" | "saanvi" | "arjun"
  | "vanya"   | "aanya"  | "shubham" | "pranav" | "aarav" | "riya"
  | "navya"   | "karan"  | "deepika"
  | "neha";

// Models confirmed working on this NIM account (tested 2026-06-28):
//   kimi-k2.6            ✅ fast
//   qwen3.5-122b         ✅ fast, large
//   qwen3-next-80b       ✅ fast
//   mistral-large-3      ✅ fast
// Timed out / unavailable on this account:
//   deepseek-v4-pro      ❌ timeout
//   minimax-m3           ❌ 404
//   mistral-nemotron     ❌ timeout
export type ModelId =
  | "moonshotai/kimi-k2.6"
  | "qwen/qwen3.5-122b-a10b"
  | "qwen/qwen3-next-80b-a3b-instruct"
  | "mistralai/mistral-nemotron"
  | "mistralai/mistral-medium-3.5-128b"
  | "qwen2.5-coder:7b-instruct-q4_K_M";

// Per-agent primary model assignment (D4)
export const AGENT_MODELS: Record<AgentName, ModelId> = {
  tilotma: "qwen/qwen3.5-122b-a10b",
  aanya:   "moonshotai/kimi-k2.6",
  shubham: "moonshotai/kimi-k2.6",
  saanvi:  "qwen/qwen3.5-122b-a10b",
  deepika: "moonshotai/kimi-k2.6",
  arjun:   "mistralai/mistral-nemotron",
  navya:   "moonshotai/kimi-k2.6",
  karan:   "moonshotai/kimi-k2.6",
  vanya:   "qwen2.5-coder:7b-instruct-q4_K_M",
  pranav:  "qwen2.5-coder:7b-instruct-q4_K_M",
  aarav:   "qwen2.5-coder:7b-instruct-q4_K_M",
  riya:    "qwen2.5-coder:7b-instruct-q4_K_M",
  neha:    "qwen/qwen3-next-80b-a3b-instruct",
};

// Fix #2: RPM is per-model globally, NOT per-agent
// Effective RPM = per-key limit × number of keys (4 keys = 4× capacity)
// The NIM client round-robins keys, so the shared bucket refills at 4× rate.
export const MODEL_RPM_LIMITS: Record<string, number> = {
  "moonshotai/kimi-k2.6":                160,
  "qwen/qwen3.5-122b-a10b":              160,
  "qwen/qwen3-next-80b-a3b-instruct":    160,
  "mistralai/mistral-nemotron":          160,
  "mistralai/mistral-medium-3.5-128b":   160,
};

// Fix #10: NIM free-tier context cap
export const NIM_CONTEXT_LIMITS: Record<string, number> = {
  "moonshotai/kimi-k2.6":                32768,
  "qwen/qwen3.5-122b-a10b":              32768,
  "qwen/qwen3-next-80b-a3b-instruct":    32768,
  "mistralai/mistral-nemotron":          32768,
  "mistralai/mistral-medium-3.5-128b":   131072,
};

// 4-tier fallback chain per agent (D14) — confirmed-working NIM models only
const NIM_FALLBACK: ModelId[] = [
  "moonshotai/kimi-k2.6",
  "mistralai/mistral-nemotron",
  "mistralai/mistral-medium-3.5-128b",
  "qwen/qwen3.5-122b-a10b",
];

export const FALLBACK_CHAIN: Record<AgentName, ModelId[]> = {
  tilotma: ["qwen/qwen3.5-122b-a10b",             "moonshotai/kimi-k2.6",           "mistralai/mistral-nemotron",        "mistralai/mistral-medium-3.5-128b"],
  aanya:   ["moonshotai/kimi-k2.6",               "qwen/qwen3.5-122b-a10b",           "mistralai/mistral-medium-3.5-128b", "qwen2.5-coder:7b-instruct-q4_K_M"],
  shubham: ["moonshotai/kimi-k2.6",               "qwen/qwen3.5-122b-a10b",           "mistralai/mistral-medium-3.5-128b", "qwen2.5-coder:7b-instruct-q4_K_M"],
  saanvi:  ["qwen/qwen3.5-122b-a10b",             "moonshotai/kimi-k2.6",           "mistralai/mistral-nemotron",        "mistralai/mistral-medium-3.5-128b"],
  deepika: ["moonshotai/kimi-k2.6",               "mistralai/mistral-nemotron",      "qwen/qwen3.5-122b-a10b",            "mistralai/mistral-medium-3.5-128b"],
  arjun:   ["mistralai/mistral-nemotron",          "moonshotai/kimi-k2.6",           "qwen/qwen3.5-122b-a10b",            "mistralai/mistral-medium-3.5-128b"],
  navya:   ["moonshotai/kimi-k2.6",               "mistralai/mistral-nemotron",      "qwen/qwen3.5-122b-a10b",            "mistralai/mistral-medium-3.5-128b"],
  karan:   ["moonshotai/kimi-k2.6",               "mistralai/mistral-nemotron",      "qwen/qwen3.5-122b-a10b",            "mistralai/mistral-medium-3.5-128b"],
  vanya:   ["qwen2.5-coder:7b-instruct-q4_K_M",  ...NIM_FALLBACK],
  pranav:  ["qwen2.5-coder:7b-instruct-q4_K_M",  ...NIM_FALLBACK],
  aarav:   ["qwen2.5-coder:7b-instruct-q4_K_M",  ...NIM_FALLBACK],
  riya:    ["qwen2.5-coder:7b-instruct-q4_K_M",  ...NIM_FALLBACK],
  neha:    ["mistralai/mistral-nemotron",          "moonshotai/kimi-k2.6",           "qwen/qwen3.5-122b-a10b",            "mistralai/mistral-medium-3.5-128b"],
};

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
