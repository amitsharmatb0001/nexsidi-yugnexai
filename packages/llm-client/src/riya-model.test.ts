import { test, expect } from "bun:test";
import { AGENT_MODELS, FALLBACK_CHAIN, OLLAMA_MODELS, OLLAMA_TOOL_MODELS } from "./types.ts";

// 2026-10-22 (Trailhead Gear Rentals): every deploy logged 'Skipping "qwen2.5-coder:7b-instruct-q4_K_M" for tool work —
// this local model can't make tool calls'. The deploy agent's work is all tool calls (compose, http checks, files), so its
// assigned local model never ran once; the roster named a model the system could not use for it.
test("the deploy agent is assigned a model that can make tool calls", () => {
  const usable = (m: string) => !OLLAMA_MODELS.has(m) || OLLAMA_TOOL_MODELS.has(m);
  expect(usable(AGENT_MODELS.riya)).toBe(true);
  expect(FALLBACK_CHAIN.riya.every(usable)).toBe(true);
});
