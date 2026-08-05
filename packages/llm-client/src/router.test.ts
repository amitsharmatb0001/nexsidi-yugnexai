import { test, expect } from "bun:test";
import { shouldUseGeminiForQA, poolForTier, thinkingLevelForTier, pipelineTierFor, shouldSkipGeminiModel, rotatedPoolForAgent } from "./router.ts";
import { recordFailure } from "./circuit-breaker.ts";
import { circuitKeyFor } from "./gemini.ts";

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

// 2026-07-24 (W0.2, full agentic upgrade): before this fix, TIER_POOLS.qa
// (gemini-3.1-pro-preview, thinking_level:HIGH) was defined but had ZERO
// callers anywhere in the codebase — routeWithFallback was only ever
// invoked with tier "generation" (docs/audit/2026-07-22-nexsidi-depth-
// audit.md). qa-loop.ts's real GAN evaluator (runExploring) called
// geminiChatWithTools(messages, tools) directly with no model, silently
// defaulting to gemini-3.5-flash. These tests pin the pool contents so a
// future edit can't silently regress QA back onto a flash model or drop
// the fallback chain — and prove the override-collapses-to-one-model
// contract routeToolsWithFallback relies on for GEMINI_GENERATION_MODEL.
test("poolForTier returns the QA pool led by the pro-thinking model, not flash", () => {
  expect(poolForTier("qa")).toEqual(["gemini-3.1-pro-preview", "gemini-3.6-flash", "gemini-3.5-flash"]);
});

test("poolForTier returns the generation pool led by gemini-3.6-flash", () => {
  expect(poolForTier("generation")).toEqual(["gemini-3.6-flash", "gemini-3.5-flash"]);
});

test("poolForTier returns the user/status pool led by the cheapest flash-lite model", () => {
  expect(poolForTier("user")).toEqual(["gemini-2.5-flash-lite", "gemini-3.5-flash"]);
});

test("poolForTier collapses to a single-model pool when an explicit override is given (preserves GEMINI_GENERATION_MODEL semantics)", () => {
  expect(poolForTier("generation", "gemini-custom-override")).toEqual(["gemini-custom-override"]);
  expect(poolForTier("qa", "gemini-custom-override")).toEqual(["gemini-custom-override"]);
});

// 2026-07-25 (Phase 1, full MVP upgrade): "plan" and "design" pin the same
// pro-tier pool as "qa" — verified live (audit-2026-07-25.md, A.3) that the
// planner previously ran on "user" (flash-lite) and dropped requested pages
// (Vision/Mission) from the generated manifest as a direct result. "a2a" is
// the new cheap agent-to-agent coordination tier, kept off the reasoning
// pools entirely.
test("poolForTier: plan and design use the pro-thinking pool, not flash-lite", () => {
  expect(poolForTier("plan")).toEqual(["gemini-3.1-pro-preview", "gemini-3.6-flash", "gemini-3.5-flash"]);
  expect(poolForTier("design")).toEqual(["gemini-3.1-pro-preview", "gemini-3.6-flash"]);
});

test("poolForTier: a2a uses the cheap flash-lite pool, same tier as user", () => {
  expect(poolForTier("a2a")).toEqual(["gemini-2.5-flash-lite", "gemini-3.5-flash"]);
});

// 2026-07-25 (Phase 0, full MVP upgrade): Gemini 3.x replaced the legacy
// thinking_budget integer with a thinking_level enum (gemini_3_1_pro.md /
// _3_5_flash.md / _3_6_flash.md, all read in full from E:/ai yug/) — sending
// both in one request is a documented 400. thinkingLevelForTier is the
// tier -> level mapping that feeds buildThinkingConfig in gemini.ts.
// 2026-07-25 (Phase 1, found LIVE mid-run on nextech10): agentChat's
// PIPELINE_TIER path was hardcoded to "generation" for every pipeline agent
// regardless of role — a second instance of the exact same bug already
// fixed once in agents/planner/src/index.ts, this time in the code path
// Arjun (Temporal-driven decomposition) actually runs through.
test("pipelineTierFor: saanvi and arjun (decide WHAT gets built) get the pro-tier plan pool", () => {
  expect(pipelineTierFor("saanvi")).toBe("plan");
  expect(pipelineTierFor("arjun")).toBe("plan");
});

test("pipelineTierFor: pranav and riya (execute an already-made decision) stay on generation", () => {
  expect(pipelineTierFor("pranav")).toBe("generation");
  expect(pipelineTierFor("riya")).toBe("generation");
});

test("thinkingLevelForTier: plan/design/qa are HIGH, generation is MEDIUM, a2a/user are LOW", () => {
  expect(thinkingLevelForTier("plan")).toBe("HIGH");
  expect(thinkingLevelForTier("design")).toBe("HIGH");
  expect(thinkingLevelForTier("qa")).toBe("HIGH");
  expect(thinkingLevelForTier("generation")).toBe("MEDIUM");
  expect(thinkingLevelForTier("a2a")).toBe("LOW");
  expect(thinkingLevelForTier("user")).toBe("LOW");
});

// 2026-07-28: real efficiency bug found live — routeWithFallback/
// routeToolsWithFallback's pool loop had NO circuit-breaker skip check (the
// agentChat NIM/Ollama chain already had this, D15: "skips any model whose
// circuit breaker is OPEN"). Without it, a pool call against an
// already-OPEN model still invoked geminiChat/geminiChatWithTools, which
// calls waitForCircuit and blocks for up to OPEN_TIMEOUT_MS (60s) waiting
// out the cooldown — on every single call, while a working fallback model
// was one line away. shouldSkipGeminiModel is the pure decision extracted
// so the pool loop can skip straight to the next model instead of waiting;
// matches this file's own stated convention of unit-testing the
// deterministic decision, not the network call it gates.
test("shouldSkipGeminiModel is false for a model with no recorded failures", () => {
  expect(shouldSkipGeminiModel("gemini-3.1-pro-preview-test-fresh")).toBe(false);
});

test("shouldSkipGeminiModel is true once a model's circuit breaker has tripped OPEN", () => {
  const model = "gemini-3.1-pro-preview-test-tripped";
  const key = circuitKeyFor(model);
  for (let i = 0; i < 5; i++) recordFailure(key); // FAILURE_THRESHOLD = 5
  expect(shouldSkipGeminiModel(model)).toBe(true);
});

// 2026-07-28: real bug found live on a fresh end-to-end run — Navya, Karan,
// and Deepika (meant to run in genuine parallel per CLAUDE.md's own design:
// "Same model = 40 RPM rate limit collision. Different models = 120 RPM
// effective capacity") all called routeToolsWithFallback("qa", ...) with the
// IDENTICAL pool in the IDENTICAL order. With the shared primary
// (gemini-3.1-pro-preview) exhausted for the whole run, all three agents
// collided on the SAME fallback model's shared 50 RPM token bucket instead
// of spreading across the 2 available fallback models — a live QA pass took
// over an hour partly because of this collision. rotatedPoolForAgent keeps
// the same quality-tier primary first but rotates the FALLBACK order
// per-agent, deterministically (not randomly, so it's reproducible/testable).
test("rotatedPoolForAgent keeps the same primary model first for every agent", () => {
  expect(rotatedPoolForAgent("qa", "navya")[0]).toBe("gemini-3.1-pro-preview");
  expect(rotatedPoolForAgent("qa", "karan")[0]).toBe("gemini-3.1-pro-preview");
  expect(rotatedPoolForAgent("qa", "deepika")[0]).toBe("gemini-3.1-pro-preview");
});

test("rotatedPoolForAgent gives at least two of navya/karan/deepika DIFFERENT first-fallback models", () => {
  const navya = rotatedPoolForAgent("qa", "navya");
  const karan = rotatedPoolForAgent("qa", "karan");
  const deepika = rotatedPoolForAgent("qa", "deepika");
  const firstFallbacks = new Set([navya[1], karan[1], deepika[1]]);
  // The whole point: not all three colliding on the exact same fallback —
  // with only 2 fallback models available, at least 2 distinct values must
  // appear across the 3 agents.
  expect(firstFallbacks.size).toBeGreaterThan(1);
});

test("rotatedPoolForAgent is deterministic — same agent name always gets the same rotation", () => {
  expect(rotatedPoolForAgent("qa", "navya")).toEqual(rotatedPoolForAgent("qa", "navya"));
});

test("rotatedPoolForAgent still contains every model from the tier's pool — no model dropped, just reordered", () => {
  const pool = poolForTier("qa");
  const rotated = rotatedPoolForAgent("qa", "karan");
  expect([...rotated].sort()).toEqual([...pool].sort());
});

test("rotatedPoolForAgent returns the pool unchanged for a 2-model (or smaller) tier — nothing to rotate", () => {
  expect(rotatedPoolForAgent("design", "aanya")).toEqual(poolForTier("design"));
});
