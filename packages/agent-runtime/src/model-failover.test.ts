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
