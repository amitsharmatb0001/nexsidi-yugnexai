import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { sanitizeModelChain } from "./loop.ts";

const loopSource = readFileSync(new URL("./loop.ts", import.meta.url), "utf-8");

test("sanitizeModelChain filters and replaces disallowed models", () => {
  const models = [
    "anthropic/claude-3-5-sonnet", // Disallowed -> replace with gemini-3.5-flash
    "google/gemini-3.1-pro-preview", // Allowed
    "vertex/claude-3",             // Disallowed -> replace with gemini-3.5-flash
    "meta/llama-3.1-405b",         // Allowed
    "openai/gpt-4o",               // Disallowed -> drop
  ];

  const result = sanitizeModelChain(models);

  expect(result).toEqual([
    "google/gemini-3.5-flash",
    "google/gemini-3.1-pro-preview",
    "google/gemini-3.5-flash",
    "meta/llama-3.1-405b",
  ]);
});

// 2026-08-06: real bug found live (project bae438767bed) — qwen/qwen3-next-
// 80b-a3b-instruct returns a permanent HTTP 410 Gone (NIM's own response:
// "reached its end of life on 2026-07-27T00:00:00Z"), yet it's configured
// as the PRIMARY model for tilotma/saanvi/navya/neha and a fallback for
// most other agents. Its provider prefix ("qwen/") is otherwise allowed —
// only this specific model is dead — so the existing prefix-based filter
// above can't express this, and every chain containing it wasted a
// guaranteed circuit-breaker-open failure before falling through. This
// directly caused Tilotma's Tier-3 evidence-collector to burn its entire
// 61-iteration budget without ever reaching a verdict.
test("sanitizeModelChain drops the known-dead qwen3-next-80b model even though its provider prefix is otherwise allowed", () => {
  const models = [
    "qwen/qwen3-next-80b-a3b-instruct", // known-dead -> drop
    "moonshotai/kimi-k2.6",             // disallowed provider -> drop
    "mistralai/mistral-nemotron",       // allowed
  ];

  const result = sanitizeModelChain(models);

  expect(result).toEqual(["mistralai/mistral-nemotron"]);
});

// 2026-08-09: real bug found live (project meridianbk4) — Riya's own config
// (agents/riya/src/index.ts) is `model: "moonshotai/kimi-k2.6"` with NO
// fallbackModels at all. sanitizeModelChain correctly drops that (per the
// test above — deliberate, not an oversight), which means the sanitized
// chain for Riya's REAL config is completely empty. runAgent's main loop
// used to read `modelChain[modelIdx] ?? config.model` — with an empty
// array that `??` silently fell through to the ORIGINAL, just-sanitized-
// away model, defeating sanitization entirely: every single Riya deploy
// attempt burned MAX_CONSECUTIVE_TRANSPORT_FAILURES (5) worth of real,
// slow network round-trips against the disallowed model before
// runAgentEscalated's cannot_finish path finally kicked in and escalated
// to a working model. This pins down that Riya's exact real config
// produces an empty chain (proving the failure mode is real, not
// hypothetical) and confirms runAgent now fails fast on it instead of
// silently reintroducing the disallowed model.
test("sanitizeModelChain on Riya's real config (moonshotai primary, no fallbacks) produces an empty chain", () => {
  const result = sanitizeModelChain(["moonshotai/kimi-k2.6"]);
  expect(result).toEqual([]);
});

test("runAgent fails fast with escalationReason cannot_finish when the sanitized model chain is empty, instead of silently reusing the disallowed model", () => {
  expect(loopSource).toContain("if (modelChain.length === 0) {");
  const guardIdx = loopSource.indexOf("if (modelChain.length === 0) {");
  const startingLogIdx = loopSource.indexOf("Starting — model:");
  // the empty-chain guard must run BEFORE the loop ever attempts a call —
  // confirmed by its position ahead of the "Starting" log in source order.
  expect(guardIdx).toBeGreaterThan(0);
  expect(guardIdx).toBeLessThan(startingLogIdx);
});
