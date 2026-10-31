import { test, expect } from "bun:test";
import { DEPLOY_AGENT_MODEL, DEPLOY_AGENT_FALLBACKS } from "./index.ts";
import { ACTIVE_NIM_MODELS } from "../../../packages/llm-client/src/types.ts";

// 2026-10-31 (Brewline 4 proof run): the deploy agent ran on meta/muse-glimmer-30b at 1 to 2.5 minutes a step; 19 steps in
// 20 minutes only read files, the time budget handed over, and gemini-3.5-flash then deployed in 21 steps and 2.5 minutes.
// The same was measured for the live reality checker on 29 September, which moved off NIM. The deploy agent starts on Gemini.
test("the deploy agent starts on Gemini, not on a NIM model", () => {
  expect(DEPLOY_AGENT_MODEL).toBe("gemini-3.5-flash");
  expect((ACTIVE_NIM_MODELS as readonly string[]).includes(DEPLOY_AGENT_MODEL)).toBe(false);
});

// runAgentEscalated runs the NIM leg first whenever the model chain keeps a NIM model; the deploy agent passes no NIM
// fallbacks, so its chain is empty and Gemini runs directly (as the reality checker does).
test("the deploy agent's model chain has no NIM leg", async () => {
  const { sanitizeModelChain } = await import("../../../packages/agent-runtime/src/loop.ts");
  expect(sanitizeModelChain([DEPLOY_AGENT_MODEL, ...DEPLOY_AGENT_FALLBACKS])).toEqual([]);
});
