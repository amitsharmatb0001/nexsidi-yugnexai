import { test, expect, beforeEach } from "bun:test";
import {
  noteGeminiRateLimited,
  isGeminiRateLimitCoolingDown,
  clearGeminiRateLimitCooldowns,
} from "./router.ts";

// 2026-08-28: real waste measured live (project 852be5aeaef4).
// gemini-3.1-pro-preview is pool[0] for the plan/design/qa tiers. In that run
// it succeeded 70 times and failed as pool[0] 105 times — a 40% success rate.
// ~60% of calls to those tiers burned a full network round-trip on a
// rate-limited model before falling back to a working one.
//
// The circuit breaker did not catch it: it opened only twice all run, because
// a 429 is correctly treated as transient and does not trip it. But
// "transient" was being treated as "retry immediately on the very next call",
// so the same throttled model was re-attempted 105 times. This cooldown is
// the missing middle ground — short enough that quota recovery is not
// delayed, long enough to stop leading with a model that just 429'd.

beforeEach(() => clearGeminiRateLimitCooldowns());

test("a model that just 429'd is skipped as pool leader", () => {
  const t0 = 1_000_000;
  noteGeminiRateLimited("gemini-3.1-pro-preview", t0);
  expect(isGeminiRateLimitCoolingDown("gemini-3.1-pro-preview", t0 + 1_000)).toBe(true);
});

test("other models are unaffected — this narrows the pool, never empties it", () => {
  const t0 = 1_000_000;
  noteGeminiRateLimited("gemini-3.1-pro-preview", t0);
  expect(isGeminiRateLimitCoolingDown("gemini-3.7-flash", t0 + 1_000)).toBe(false);
  expect(isGeminiRateLimitCoolingDown("gemini-3.5-flash", t0 + 1_000)).toBe(false);
});

test("the cooldown expires quickly — a rate limit is not a broken endpoint", () => {
  const t0 = 1_000_000;
  noteGeminiRateLimited("gemini-3.1-pro-preview", t0);
  // Well before the circuit breaker's 60s OPEN_TIMEOUT_MS.
  expect(isGeminiRateLimitCoolingDown("gemini-3.1-pro-preview", t0 + 21_000)).toBe(false);
});

test("an untouched model is never considered cooling down", () => {
  expect(isGeminiRateLimitCoolingDown("gemini-3.6-flash", Date.now())).toBe(false);
});

test("routeToolsWithFallback still attempts every model when all are cooling down", () => {
  // Source-shape guarantee: the two-pass order must include the deferred
  // models, or a cooldown could turn into a false "all pool models exhausted".
  const src = require("node:fs").readFileSync(new URL("./router.ts", import.meta.url), "utf-8");
  expect(src).toContain("const attemptOrder = [...ready, ...deferred]");
  expect(src).toContain("attempting anyway rather than failing without trying");
});
