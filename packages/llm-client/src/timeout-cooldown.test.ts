import { test, expect, beforeEach } from "bun:test";
import { routeToolsWithFallback, clearGeminiRateLimitCooldowns, isGeminiRateLimitCoolingDown } from "./router.ts";

// 2026-10-23 (Brewline test build, measured with the per-call log): on project ai-ns-yug gemini-3.8-flash answered 0 of 4
// calls; every one hung until the 120 s timeout, 8 minutes lost in the first 30 minutes. It stayed first in line because
// only a rate-limit error put a model on cooldown. A timeout now does too, so the next calls go straight to a model that
// answers, and the model is tried again once the cooldown ends.

beforeEach(() => clearGeminiRateLimitCooldowns());

test("a model that times out is skipped on the next call", async () => {
  const tried: string[] = [];
  const chat = async (_m: unknown, _t: unknown, o?: { model?: string }) => {
    tried.push(String(o?.model));
    if (tried.length === 1) throw new Error(`[Gemini ${o?.model}] AbortError: The operation was aborted.`);
    return { content: "ok", toolCalls: [], stopReason: "STOP", rawParts: [{ text: "ok" }] };
  };
  const first = await routeToolsWithFallback("generation", [{ role: "user", content: "x" }], [], {}, { chat: chat as never });
  const timedOut = tried[0]!;
  expect(first.modelUsed).not.toBe(timedOut);
  expect(isGeminiRateLimitCoolingDown(timedOut)).toBe(true);
  tried.length = 0;
  await routeToolsWithFallback("generation", [{ role: "user", content: "x" }], [], {}, { chat: chat as never });
  expect(tried[0]).not.toBe(timedOut);
});
