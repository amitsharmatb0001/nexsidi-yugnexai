import { test, expect } from "bun:test";
import { isContextLengthExceededError, isUnrecoverableGeminiError, isAllPoolModelsExhaustedError, screenshotImagePathFor } from "./gemini-loop.ts";

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

// 2026-07-28: real bug found live — "screenshot"/"browser_screenshot" tool
// results carried only a text path ("Screenshot saved to X"); no image
// bytes ever reached a model, so every visual QA judgment was DOM/text-only.
// A build with sitewide corrupted-glyph text scored 7.47/10 against a 7.0
// pass bar as direct proof (.nexsidi/sdd/agent-autonomy-assessment-2026-07-26.md,
// F9). screenshotImagePathFor is the pure decision of whether/where to read
// image bytes from a tool result — the loop attaches them as an inlineData
// part right after the functionResponse for the same call.
test("screenshotImagePathFor returns the image path for a successful screenshot tool call", () => {
  expect(screenshotImagePathFor("screenshot", { status: "success", output: "/tmp/shot.png" })).toBe("/tmp/shot.png");
  expect(screenshotImagePathFor("browser_screenshot", { status: "success", output: "/tmp/shot2.png" })).toBe("/tmp/shot2.png");
});

test("screenshotImagePathFor returns null for a non-screenshot tool call", () => {
  expect(screenshotImagePathFor("read_file", { status: "success", output: "/tmp/shot.png" })).toBeNull();
});

test("screenshotImagePathFor returns null when the screenshot tool call itself failed", () => {
  expect(screenshotImagePathFor("screenshot", { status: "error", summary: "invalid URL" })).toBeNull();
});

test("screenshotImagePathFor returns null when result.output is missing or not a string", () => {
  expect(screenshotImagePathFor("screenshot", { status: "success" })).toBeNull();
  expect(screenshotImagePathFor("screenshot", { status: "success", output: 123 })).toBeNull();
});

// ── isAllPoolModelsExhaustedError ────────────────────────────────────────────
// 2026-08-04 (live, verify057463): real bug found live — the "design" tier's
// entire model pool (gemini-3.1-pro-preview AND gemini-3.6-flash) had their
// circuit breakers OPEN simultaneously. The generic catch-all error path
// (errors.push + sleep 5s + continue) treated this exactly like any single
// transient failure, so Aanya looped through all 60 iterations — each one
// guaranteed to fail identically, since a circuit that's OPEN doesn't clear
// itself in 5 seconds — burning ~8.3 minutes of wall-clock/iteration budget
// on a call that could never succeed. Detecting this specific shape lets the
// loop abort fast (matching isUnrecoverableGeminiError's existing pattern)
// instead of grinding to MAX_ITERATIONS.
test("isAllPoolModelsExhaustedError recognizes the routeToolsWithFallback all-models-exhausted shape", () => {
  const err = new Error(
    "[llm-client] routeToolsWithFallback(design) — all pool models exhausted:\n" +
      "  gemini-3.1-pro-preview: circuit breaker OPEN — skipped\n" +
      "  gemini-3.6-flash: circuit breaker OPEN — skipped",
  );
  expect(isAllPoolModelsExhaustedError(err)).toBe(true);
});

test("isAllPoolModelsExhaustedError is false for a single transient failure (fallback still available)", () => {
  const err = new Error("[Gemini gemini-3.1-pro-preview] 429: Resource exhausted");
  expect(isAllPoolModelsExhaustedError(err)).toBe(false);
});

test("isAllPoolModelsExhaustedError is false for an unrelated error", () => {
  expect(isAllPoolModelsExhaustedError(new Error("ECONNREFUSED"))).toBe(false);
});
