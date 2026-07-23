export type AgentName =
  | "tilotma" | "saanvi" | "arjun"
  | "vanya"   | "aanya"  | "shubham" | "pranav" | "aarav" | "riya"
  | "navya"   | "karan"  | "deepika"
  | "neha";

// Models confirmed working on this NIM account (tested 2026-06-28):
//   kimi-k2.6            ✅ fast
//   qwen3-next-80b       ✅ fast
//   mistral-large-3      ✅ fast
// Timed out / unavailable on this account:
//   deepseek-v4-pro      ❌ timeout (as of 2026-06-28; re-verify before promoting)
//   minimax-m3           ❌ 404
//   mistral-nemotron     ❌ timeout
// Removed 2026-07-20 (HTTP 410 Gone from NIM):
//   qwen/qwen3.5-122b-a10b ❌ 410 — endpoint removed. Replaced with qwen3-next-80b.
// Confirmed working 2026-07-03 (scripts/ping-nim.ts):
//   z-ai/glm-5.2         ✅ fast THAT DAY — DEMOTED 2026-07-04: scripts/
//                           ping-glm.ts probed 5 request shapes (tiny chat,
//                           tools no-history, tools with tool-result history,
//                           ~90K input, ~24K input) and ALL FIVE hung past the
//                           120s timeout. The endpoint is intermittently
//                           unresponsive — stress-2/3 logs show it answering
//                           iteration 1 then hanging on iteration 2 in every
//                           agent, and hanging outright for all 3 QA agents.
//                           Removed from ALL chains (not just demoted): a
//                           hanging endpoint costs a full 120s timeout per
//                           attempt before failover. Re-promote only after a
//                           future ping-glm.ts run passes cleanly.
// NOTE the "confirmed working" dates matter: free-tier NIM endpoints have no
// SLA and their reliability changes day to day — mistral-nemotron was marked
// "❌ timeout" on 2026-06-28 above yet served Arjun fine in later runs, and
// processed an 85K-token QA review on 2026-07-04. Re-verify with ping-nim.ts
// / ping-glm.ts before trusting any entry in this comment block.
export type ModelId =
  | "moonshotai/kimi-k2.6"
  | "qwen/qwen3-next-80b-a3b-instruct"
  | "qwen/qwen3-next-80b-a3b-instruct"
  | "mistralai/mistral-nemotron"
  | "mistralai/mistral-medium-3.5-128b"
  | "qwen2.5-coder:7b-instruct-q4_K_M"
  | "z-ai/glm-5.2"
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
  | "gemini-2.5-flash-lite";

// Per-agent primary model assignment (D4)
// Roster history for aanya/shubham/navya/karan/deepika:
//   kimi-k2.6 (failed F7, 2026-07-03) -> z-ai/glm-5.2 (2026-07-03) ->
//   current (2026-07-04): glm-5.2's endpoint proven hanging via
//   scripts/ping-glm.ts (see ModelId comment above) and removed entirely.
// Replacements chosen from what DEMONSTRABLY worked in stress-2/3 run logs,
// not from assumptions: mistral-medium-3.5-128b performed all of Aanya's and
// Shubham's actual generation work as the fallback in both runs; qwen3.5-122b
// handled Karan's and Navya's 80K+ token QA reviews; mistral-nemotron handled
// Deepika's 85K-token review. QA trio kept on 3 DIFFERENT primaries per D4's
// parallel-dispatch rate-limit rule (they run simultaneously).
export const AGENT_MODELS: Record<AgentName, ModelId> = {
  tilotma: "qwen/qwen3-next-80b-a3b-instruct",
  aanya:   "mistralai/mistral-medium-3.5-128b",
  shubham: "mistralai/mistral-medium-3.5-128b",
  saanvi:  "qwen/qwen3-next-80b-a3b-instruct",
  deepika: "mistralai/mistral-nemotron",
  arjun:   "mistralai/mistral-nemotron",
  navya:   "qwen/qwen3-next-80b-a3b-instruct",
  karan:   "mistralai/mistral-medium-3.5-128b",
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
  "qwen/qwen3-next-80b-a3b-instruct":              160,
  "qwen/qwen3-next-80b-a3b-instruct":    160,
  "mistralai/mistral-nemotron":          160,
  "mistralai/mistral-medium-3.5-128b":   160,
  "z-ai/glm-5.2":                        160, // not independently verified — matches the other confirmed-working models' rate on this account until observed otherwise
};

// Fix #10: NIM free-tier context cap
export const NIM_CONTEXT_LIMITS: Record<string, number> = {
  "moonshotai/kimi-k2.6":                32768,
  // Measured directly, not assumed: scripts/ping-qa-large.ts intentionally
  // overshot and got the API's own 400 error back verbatim — "This model's
  // maximum context length is 262144 tokens" (2026-07-04). The prior 32768
  // entry was never measured for this model; it was a guessed default that
  // happened to also match several genuinely-32K models in this table.
  "qwen/qwen3-next-80b-a3b-instruct":              262144,
  "qwen/qwen3-next-80b-a3b-instruct":    32768,
  "mistralai/mistral-nemotron":          32768,
  "mistralai/mistral-medium-3.5-128b":   131072,
  "z-ai/glm-5.2":                        32768, // not independently verified — conservative default, same as the other 32K-class models above; model itself demoted from every fallback chain (see ModelId comment) after being proven to hang on every request shape
};

// 4-tier fallback chain per agent (D14) — confirmed-working NIM models only
const NIM_FALLBACK: ModelId[] = [
  "moonshotai/kimi-k2.6",
  "mistralai/mistral-nemotron",
  "mistralai/mistral-medium-3.5-128b",
  "qwen/qwen3-next-80b-a3b-instruct",
];

export const FALLBACK_CHAIN: Record<AgentName, ModelId[]> = {
  tilotma: ["qwen/qwen3-next-80b-a3b-instruct",             "moonshotai/kimi-k2.6",           "mistralai/mistral-nemotron",        "mistralai/mistral-medium-3.5-128b"],
  // aanya/shubham/navya/karan/deepika: glm-5.2 removed from ALL chains
  // (2026-07-04) after scripts/ping-glm.ts proved its endpoint hangs past
  // the 120s timeout on every request shape — as a fallback it would cost a
  // full 2-minute stall per attempt before failing over. kimi-k2.6 removed
  // earlier (2026-07-03) after failing reproducibly in these exact roles.
  // Replacements are the models that DID the work in stress-2/3 run logs
  // (see AGENT_MODELS comment above). QA trio primaries kept distinct per
  // D4's parallel-dispatch rule.
  aanya:   ["mistralai/mistral-medium-3.5-128b",  "qwen/qwen3-next-80b-a3b-instruct",         "qwen2.5-coder:7b-instruct-q4_K_M"],
  shubham: ["mistralai/mistral-medium-3.5-128b",  "qwen/qwen3-next-80b-a3b-instruct",         "qwen2.5-coder:7b-instruct-q4_K_M"],
  saanvi:  ["qwen/qwen3-next-80b-a3b-instruct",             "moonshotai/kimi-k2.6",           "mistralai/mistral-nemotron",        "mistralai/mistral-medium-3.5-128b"],
  deepika: ["mistralai/mistral-nemotron",          "qwen/qwen3-next-80b-a3b-instruct",         "mistralai/mistral-medium-3.5-128b"],
  arjun:   ["mistralai/mistral-nemotron",          "moonshotai/kimi-k2.6",           "qwen/qwen3-next-80b-a3b-instruct",            "mistralai/mistral-medium-3.5-128b"],
  navya:   ["qwen/qwen3-next-80b-a3b-instruct",             "mistralai/mistral-nemotron",     "mistralai/mistral-medium-3.5-128b"],
  karan:   ["mistralai/mistral-medium-3.5-128b",  "mistralai/mistral-nemotron",     "qwen/qwen3-next-80b-a3b-instruct"],
  vanya:   ["qwen2.5-coder:7b-instruct-q4_K_M",  ...NIM_FALLBACK],
  pranav:  ["qwen2.5-coder:7b-instruct-q4_K_M",  ...NIM_FALLBACK],
  aarav:   ["qwen2.5-coder:7b-instruct-q4_K_M",  ...NIM_FALLBACK],
  riya:    ["qwen2.5-coder:7b-instruct-q4_K_M",  ...NIM_FALLBACK],
  neha:    ["mistralai/mistral-nemotron",          "moonshotai/kimi-k2.6",           "qwen/qwen3-next-80b-a3b-instruct",            "mistralai/mistral-medium-3.5-128b"],
};

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
