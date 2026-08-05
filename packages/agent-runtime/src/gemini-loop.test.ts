import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { isContextLengthExceededError, isUnrecoverableGeminiError, isAllPoolModelsExhaustedError, isQuotaExhaustionError, screenshotImagePathFor } from "./gemini-loop.ts";

const source = readFileSync(new URL("./gemini-loop.ts", import.meta.url), "utf-8");

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

// ── isQuotaExhaustionError ───────────────────────────────────────────────────
// 2026-08-05 (live, d709f34a800e): real bug found live — a full-pool-exhaustion
// GeneratorExhausted failure (the exact shape isAllPoolModelsExhaustedError
// detects above) was ALWAYS thrown nonRetryable:true by pipeline/activities/
// index.ts's generatorFailure, killing the entire workflow instantly instead
// of waiting out the same circuit-breaker cooldown stage6-deployment.ts's
// deployWithQuotaRetry already handles for the redeploy step. This is the
// shared check both now use — moved here (was previously duplicated only in
// stage6-deployment.ts) since generator activities need the identical logic.
test("isQuotaExhaustionError recognizes the exact GeneratorExhausted message shape", () => {
  expect(
    isQuotaExhaustionError([
      "Gemini call failed on iteration 9 — every model in the pool is circuit-broken, aborting early instead of grinding to MAX_ITERATIONS on a call that cannot succeed as-is: Error: [llm-client] routeToolsWithFallback(design) — all pool models exhausted:\ngemini-3.6-flash: 429 RESOURCE_EXHAUSTED",
    ]),
  ).toBe(true);
});

test("isQuotaExhaustionError returns false for a genuine generator error", () => {
  expect(isQuotaExhaustionError(["Agent stopped calling tools for 5 turns without calling task_complete"])).toBe(false);
});

test("isQuotaExhaustionError returns false for an empty errors list", () => {
  expect(isQuotaExhaustionError([])).toBe(false);
});

// 2026-08-05 (live, project 193c3080e582): the original no-tool-call nudge
// asked the model to "actually call the tool now" but never forbade
// re-reasoning — combined with core-reasoning.md's Rule 1 ("before doing
// anything, write three lines"), a weaker model responded to the
// correction by writing ANOTHER <thinking> block restating its plan
// instead of executing it, repeating until MAX_NO_TOOL_CALL_TURNS killed
// the whole generator. Confirms the strengthened nudge is actually wired,
// not just described in a comment.
test("the no-tool-call nudge explicitly forbids writing another thinking block", () => {
  expect(source).toContain("Do NOT write another <thinking> block restating or expanding your plan");
});
