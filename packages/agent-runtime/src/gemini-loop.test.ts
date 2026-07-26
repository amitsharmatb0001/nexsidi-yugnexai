import { test, expect } from "bun:test";
import { isContextLengthExceededError, isUnrecoverableGeminiError } from "./gemini-loop.ts";

// 2026-07-25 (Phase 2.5.1, full MVP upgrade): no gemini-loop.ts test file
// existed at all before this — confirmed in .nexsidi/sdd/audit-2026-07-25.md
// as a gap: this is the loop that actually runs in production
// (GENERATOR_TIER=gemini), and it had zero direct test coverage. This file
// covers the two pure error-classification functions added/present here;
// the full agent loop itself still requires a live network call to exercise
// (same convention as router.ts's shouldUseGeminiForQA — the pure decision
// is unit-tested, the network call it gates is exercised by live runs).

test("isContextLengthExceededError recognizes Vertex's context-exceeded error shapes", () => {
  expect(isContextLengthExceededError(new Error("input token count (1200000) exceeds the maximum number of tokens allowed"))).toBe(true);
  expect(isContextLengthExceededError(new Error("Request exceeds the model's maximum context length"))).toBe(true);
  expect(isContextLengthExceededError(new Error("400 CONTEXT_LENGTH_EXCEEDED: too many tokens"))).toBe(true);
});

test("isContextLengthExceededError does not misclassify an unrelated error", () => {
  expect(isContextLengthExceededError(new Error("429 RESOURCE_EXHAUSTED"))).toBe(false);
  expect(isContextLengthExceededError(new Error("ECONNREFUSED"))).toBe(false);
  expect(isContextLengthExceededError(new Error("UNAUTHENTICATED: invalid credentials"))).toBe(false);
});

test("isUnrecoverableGeminiError and isContextLengthExceededError are mutually exclusive categories", () => {
  // A context-exceeded error must never ALSO be treated as unrecoverable
  // (it should trigger emergency compaction + retry, not an early abort) —
  // and vice versa.
  const contextErr = new Error("input token count exceeds the maximum number of tokens");
  expect(isContextLengthExceededError(contextErr)).toBe(true);
  expect(isUnrecoverableGeminiError(contextErr)).toBe(false);

  const authErr = new Error("UNAUTHENTICATED: no access token");
  expect(isUnrecoverableGeminiError(authErr)).toBe(true);
  expect(isContextLengthExceededError(authErr)).toBe(false);
});
