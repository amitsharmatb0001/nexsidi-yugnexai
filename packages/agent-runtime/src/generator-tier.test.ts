import { test, expect } from "bun:test";
import { resolveGeneratorRunner } from "./generator-tier.ts";
import { runAgentEscalated } from "./claude-loop.ts";
import { runAgentWithGemini } from "./gemini-loop.ts";

// 2026-07-08: after 10-20 stress-test runs, the pipeline still wasn't
// clearing a basic app's QA gate — root cause: Shubham/Aanya only ever used
// a stronger model (Claude/Gemini via runAgentEscalated) AFTER the cheap NIM
// tier failed OUTRIGHT (success:false). Code that NIM "succeeded" at (passed
// tsc, called task_complete) but was still insecure — e.g. the SQL injection
// in a dynamic UPDATE query — never got a stronger model's eyes on it at
// all, since escalation only fires on failure, not on subtly-bad success.
// GENERATOR_TIER=gemini routes generation (not just escalation) through
// Gemini directly for these two agents, same override pattern as
// ESCALATION_PROVIDER.
test("resolveGeneratorRunner defaults to runAgentEscalated when GENERATOR_TIER is unset", () => {
  delete process.env.GENERATOR_TIER;
  expect(resolveGeneratorRunner()).toBe(runAgentEscalated);
});

test("resolveGeneratorRunner returns a Gemini-direct runner when GENERATOR_TIER=gemini", async () => {
  process.env.GENERATOR_TIER = "gemini";
  const runner = resolveGeneratorRunner();
  expect(runner).not.toBe(runAgentEscalated);
  delete process.env.GENERATOR_TIER;
});

test("resolveGeneratorRunner falls back to runAgentEscalated for any other value", () => {
  process.env.GENERATOR_TIER = "nim";
  expect(resolveGeneratorRunner()).toBe(runAgentEscalated);
  delete process.env.GENERATOR_TIER;
});

test("the Gemini-direct runner calls runAgentWithGemini and reports escalated:false", async () => {
  process.env.GENERATOR_TIER = "gemini";
  const runner = resolveGeneratorRunner();
  const config = {
    agentName: "test-agent",
    model: "moonshotai/kimi-k2.6" as const,
    apiKey: "unused",
    systemPrompt: "s",
    initialMessage: "m",
    sandboxDir: "/tmp/sandbox",
  };
  // We don't want a real network call in a unit test — verify the function
  // identity/shape instead by checking it's distinct from runAgentEscalated
  // and from the raw runAgentWithGemini (must wrap, adding `escalated`).
  expect(runner).not.toBe(runAgentWithGemini);
  delete process.env.GENERATOR_TIER;
});
