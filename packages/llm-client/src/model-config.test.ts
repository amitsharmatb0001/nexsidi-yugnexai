import { test, expect } from "bun:test";
import { ACTIVE_NIM_MODELS, AGENT_MODELS, FALLBACK_CHAIN, MODEL_RPM_LIMITS, NIM_CONTEXT_LIMITS, OLLAMA_MODELS, OLLAMA_TOOL_MODELS, RETIRED_NIM_MODELS } from "./types.ts";

// 2026-09-28: live check of every NIM model NexSidi was configured with —
// kimi-k2.6 404 (not on this account), qwen3-next-80b / mistral-nemotron /
// mistral-medium-3.5-128b / glm-5.2 all 410 (end of life). None could serve a
// single call, yet every agent tried them first. Removed from all live
// configuration (Amit's call); they stay listed only as retired, with evidence.
test("the retired list holds every NIM model that failed the 2026-09-28 live check", () => {
  expect(Object.keys(RETIRED_NIM_MODELS).sort()).toEqual([
    "mistralai/mistral-medium-3.5-128b",
    "mistralai/mistral-nemotron",
    "moonshotai/kimi-k2.6",
    "qwen/qwen3-next-80b-a3b-instruct",
    "z-ai/glm-5.2",
  ]);
});

test("no agent's primary model or fallback chain uses a retired NIM model", () => {
  const configured = [...Object.values(AGENT_MODELS), ...Object.values(FALLBACK_CHAIN).flat()];
  for (const model of configured) expect({ model, retired: model in RETIRED_NIM_MODELS }).toEqual({ model, retired: false });
});

test("no rate-limit or context-limit entry is kept for a retired NIM model", () => {
  for (const model of [...Object.keys(MODEL_RPM_LIMITS), ...Object.keys(NIM_CONTEXT_LIMITS)]) {
    expect({ model, retired: model in RETIRED_NIM_MODELS }).toEqual({ model, retired: false });
  }
});

// 2026-09-28: new NIM catalogue evaluated live (2 chats, 1 tool call, 1 coding
// task run against 8 tests; 150s limit). Only two passed: meta/muse-glimmer-30b
// (chat 7s/15s, tools 2.7s, coding 8/8 in 41s) and nemotron-3-ultra (8/8 but
// 104s, one 503). Too slow / timing out: deepseek-v4.1-flash, glm-5.3-flash,
// nemotron-3.5-lightning; not answering: kimi-k3, glm-5.3; overloaded:
// nemotron-3-super.
test("exactly the NIM models that passed the live evaluation are active, each with rate and context limits", () => {
  expect([...ACTIVE_NIM_MODELS]).toEqual(["meta/muse-glimmer-30b", "nvidia/nemotron-3-ultra-550b-a55b"]);
  for (const m of ACTIVE_NIM_MODELS) {
    expect(MODEL_RPM_LIMITS[m]).toBeGreaterThan(0);
    expect(NIM_CONTEXT_LIMITS[m]).toBeGreaterThan(0);
  }
});

test("NIM-path agents try the evaluated models in order; Ollama agents keep their local model first", () => {
  expect(FALLBACK_CHAIN.pranav).toEqual(["qwen2.5-coder:7b-instruct-q4_K_M", "meta/muse-glimmer-30b", "nvidia/nemotron-3-ultra-550b-a55b"]);
  // 2026-10-22: the deploy agent only does tool work, which the local model cannot do (see riya-model.test.ts).
  expect(FALLBACK_CHAIN.riya).toEqual(["meta/muse-glimmer-30b", "nvidia/nemotron-3-ultra-550b-a55b"]);
  expect(FALLBACK_CHAIN.tilotma).toEqual(["meta/muse-glimmer-30b", "nvidia/nemotron-3-ultra-550b-a55b"]);
  expect(AGENT_MODELS.tilotma).toBe("meta/muse-glimmer-30b");
});

// Measured 2026-09-28: qwen2.5-coder:7b answered a tool-call prompt with plain
// text (no tool call) and scored 4/8 on the coding task — it can chat, but it
// can't run an agent's tool loop.
test("the local Ollama model is known by name but is not marked tool-capable", () => {
  expect(OLLAMA_MODELS.has("qwen2.5-coder:7b-instruct-q4_K_M")).toBe(true);
  expect(OLLAMA_TOOL_MODELS.has("qwen2.5-coder:7b-instruct-q4_K_M")).toBe(false);
});
