export type AgentName =
  | "tilotma" | "saanvi" | "arjun"
  | "vanya"   | "aanya"  | "shubham" | "pranav" | "aarav" | "riya"
  | "navya"   | "karan"  | "deepika"
  | "neha";

export type ModelId =
  | "deepseek-ai/deepseek-v4-pro"
  | "minimax/minimax-m3"
  | "mistralai/mistral-nemotron"
  | "moonshotai/kimi-k2.6"
  | "qwen2.5-coder:7b-instruct-q4_K_M";

// Per-agent model assignment (D4)
export const AGENT_MODELS: Record<AgentName, ModelId> = {
  tilotma: "deepseek-ai/deepseek-v4-pro",
  aanya:   "deepseek-ai/deepseek-v4-pro",
  shubham: "deepseek-ai/deepseek-v4-pro",
  saanvi:  "minimax/minimax-m3",
  deepika: "minimax/minimax-m3",
  arjun:   "mistralai/mistral-nemotron",
  navya:   "moonshotai/kimi-k2.6",
  karan:   "moonshotai/kimi-k2.6",
  vanya:   "qwen2.5-coder:7b-instruct-q4_K_M",
  pranav:  "qwen2.5-coder:7b-instruct-q4_K_M",
  aarav:   "qwen2.5-coder:7b-instruct-q4_K_M",
  riya:    "qwen2.5-coder:7b-instruct-q4_K_M",
  neha:    "minimax/minimax-m3",
};

// Fix #2: RPM is per-model globally, NOT per-agent
// Tilotma + Aanya + Shubham share the same 40 RPM deepseek-v4-pro bucket
export const MODEL_RPM_LIMITS: Record<string, number> = {
  "deepseek-ai/deepseek-v4-pro": 40,
  "minimax/minimax-m3":          40,
  "mistralai/mistral-nemotron":  40,
  "moonshotai/kimi-k2.6":        40,
};

// Fix #10: NIM free-tier context cap (conservative — actual model max is higher)
// Always use this value for max_tokens calculation, not the model's theoretical limit
export const NIM_CONTEXT_LIMITS: Record<string, number> = {
  "deepseek-ai/deepseek-v4-pro": 32768,
  "minimax/minimax-m3":          32768,
  "mistralai/mistral-nemotron":  32768,
  "moonshotai/kimi-k2.6":        32768,
};

// 4-tier fallback chain per agent (D14)
export const FALLBACK_CHAIN: Record<AgentName, ModelId[]> = {
  tilotma: ["deepseek-ai/deepseek-v4-pro", "minimax/minimax-m3", "mistralai/mistral-nemotron", "qwen2.5-coder:7b-instruct-q4_K_M"],
  aanya:   ["deepseek-ai/deepseek-v4-pro", "minimax/minimax-m3", "mistralai/mistral-nemotron", "qwen2.5-coder:7b-instruct-q4_K_M"],
  shubham: ["deepseek-ai/deepseek-v4-pro", "minimax/minimax-m3", "mistralai/mistral-nemotron", "qwen2.5-coder:7b-instruct-q4_K_M"],
  saanvi:  ["minimax/minimax-m3",          "deepseek-ai/deepseek-v4-pro", "mistralai/mistral-nemotron", "qwen2.5-coder:7b-instruct-q4_K_M"],
  deepika: ["minimax/minimax-m3",          "deepseek-ai/deepseek-v4-pro", "moonshotai/kimi-k2.6",       "qwen2.5-coder:7b-instruct-q4_K_M"],
  arjun:   ["mistralai/mistral-nemotron",  "deepseek-ai/deepseek-v4-pro", "minimax/minimax-m3",          "qwen2.5-coder:7b-instruct-q4_K_M"],
  navya:   ["moonshotai/kimi-k2.6",        "deepseek-ai/deepseek-v4-pro", "minimax/minimax-m3",          "qwen2.5-coder:7b-instruct-q4_K_M"],
  karan:   ["moonshotai/kimi-k2.6",        "deepseek-ai/deepseek-v4-pro", "minimax/minimax-m3",          "qwen2.5-coder:7b-instruct-q4_K_M"],
  vanya:   ["qwen2.5-coder:7b-instruct-q4_K_M",            "deepseek-ai/deepseek-v4-pro", "minimax/minimax-m3",          "mistralai/mistral-nemotron"],
  pranav:  ["qwen2.5-coder:7b-instruct-q4_K_M",            "deepseek-ai/deepseek-v4-pro", "minimax/minimax-m3",          "mistralai/mistral-nemotron"],
  aarav:   ["qwen2.5-coder:7b-instruct-q4_K_M",            "deepseek-ai/deepseek-v4-pro", "minimax/minimax-m3",          "mistralai/mistral-nemotron"],
  riya:    ["qwen2.5-coder:7b-instruct-q4_K_M",            "deepseek-ai/deepseek-v4-pro", "minimax/minimax-m3",          "mistralai/mistral-nemotron"],
  neha:    ["minimax/minimax-m3",          "deepseek-ai/deepseek-v4-pro", "mistralai/mistral-nemotron",  "qwen2.5-coder:7b-instruct-q4_K_M"],
};

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
