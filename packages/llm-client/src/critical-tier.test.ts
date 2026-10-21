import { test, expect, afterEach } from "bun:test";
import { allPoolModels, poolForTier, thinkingLevelForTier, pipelineTierFor, rotatedPoolForAgent } from "./router.ts";

// gemini-4-argon (general release 2026-10-13, 1M tokens in and out, text output) leads a "critical" tier used for the hardest
// reasoning work: the plan that decides what gets built, the final reality check, and settling disputes between a reviewer and a
// builder. The proven models stay behind it, so if argon is unavailable or fails, the pool moves on at once.

afterEach(() => {
  delete process.env.GEMINI_CRITICAL_ARGON;
});

test("the critical tier leads with gemini-4-argon and keeps the proven models behind it, in order", () => {
  expect(poolForTier("critical")).toEqual(["gemini-4-argon", "gemini-3.1-pro-preview", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"]);
});

test("setting GEMINI_CRITICAL_ARGON=off takes argon out and nothing else changes", () => {
  process.env.GEMINI_CRITICAL_ARGON = "off";
  expect(poolForTier("critical")).toEqual(["gemini-3.1-pro-preview", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"]);
  expect(poolForTier("plan")).toEqual(["gemini-3.1-pro-preview", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"]);
});

test("no other tier uses argon: it is for the hardest work only", () => {
  for (const tier of ["plan", "design", "qa", "generation", "a2a", "user"] as const) expect(poolForTier(tier)).not.toContain("gemini-4-argon");
});

test("an explicitly chosen model still wins and has no fallback", () => {
  expect(poolForTier("critical", "gemini-3.8-flash")).toEqual(["gemini-3.8-flash"]);
});

test("the critical tier thinks at the highest level", () => {
  expect(thinkingLevelForTier("critical")).toBe("HIGH");
});

test("rotating fallbacks per agent keeps argon first", () => {
  for (const agent of ["tilotma", "saanvi", "arjun", "navya"]) expect(rotatedPoolForAgent("critical", agent)[0]).toBe("gemini-4-argon");
});

test("the model is listed among the pool models, so the spend table is required to price it", () => {
  expect(allPoolModels()).toContain("gemini-4-argon");
});

test("the plan that decides what gets built runs on the critical tier; the agents that carry out a decision do not", () => {
  expect(pipelineTierFor("saanvi")).toBe("critical");
  expect(pipelineTierFor("arjun")).toBe("critical");
  expect(pipelineTierFor("pranav")).toBe("generation");
  expect(pipelineTierFor("riya")).toBe("generation");
});
