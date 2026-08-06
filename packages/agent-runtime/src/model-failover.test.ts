import { test, expect } from "bun:test";
import { sanitizeModelChain } from "./loop.ts";

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
