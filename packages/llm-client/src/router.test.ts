import { test, expect } from "bun:test";
import { shouldUseGeminiForQA } from "./router.ts";

// 2026-07-08: root-caused why a Gemini-primary generation run still took
// 6.5 hours (23,511s) despite generation itself finishing in minutes —
// Navya/Karan/Deepika's QA reviews are ~80,000-INPUT-TOKEN calls (the full
// generated codebase as text) and STILL routed through NIM's free/slow
// tier via agentChat's fixed FALLBACK_CHAIN, completely unaffected by
// GENERATOR_TIER=gemini (which only touches Shubham/Aanya's tool-calling
// loop, not this one-shot chat path). QA_TIER=gemini routes QA agents
// through Gemini too — same override pattern as GENERATOR_TIER/
// ESCALATION_PROVIDER. shouldUseGeminiForQA is the pure routing decision;
// the actual network call it gates is exercised by live runs, not unit
// tests (matches this repo's convention for every other provider switch).

test("shouldUseGeminiForQA is false when QA_TIER is unset, even for a QA agent", () => {
  delete process.env.QA_TIER;
  expect(shouldUseGeminiForQA("navya")).toBe(false);
  expect(shouldUseGeminiForQA("karan")).toBe(false);
  expect(shouldUseGeminiForQA("deepika")).toBe(false);
});

test("shouldUseGeminiForQA is true for navya/karan/deepika when QA_TIER=gemini", () => {
  process.env.QA_TIER = "gemini";
  expect(shouldUseGeminiForQA("navya")).toBe(true);
  expect(shouldUseGeminiForQA("karan")).toBe(true);
  expect(shouldUseGeminiForQA("deepika")).toBe(true);
  delete process.env.QA_TIER;
});

test("shouldUseGeminiForQA is false for non-QA agents even when QA_TIER=gemini — scoped to QA only", () => {
  process.env.QA_TIER = "gemini";
  expect(shouldUseGeminiForQA("saanvi")).toBe(false);
  expect(shouldUseGeminiForQA("arjun")).toBe(false);
  delete process.env.QA_TIER;
});

test("shouldUseGeminiForQA is false for any other QA_TIER value", () => {
  process.env.QA_TIER = "nim";
  expect(shouldUseGeminiForQA("navya")).toBe(false);
  delete process.env.QA_TIER;
});
