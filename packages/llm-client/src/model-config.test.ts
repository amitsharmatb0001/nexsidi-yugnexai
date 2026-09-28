import { test, expect } from "bun:test";
import { AGENT_MODELS, FALLBACK_CHAIN, MODEL_RPM_LIMITS, NIM_CONTEXT_LIMITS, RETIRED_NIM_MODELS } from "./types.ts";

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
