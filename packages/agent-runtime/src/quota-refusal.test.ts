import { test, expect } from "bun:test";
import { isQuotaExhaustionError } from "./gemini-loop.ts";

// 2026-10-23: a provider's terms-of-use refusal was counted as quota exhaustion and the build waited up to 2 hours for it to
// clear. It never does; the step now stops at once (see llm-client provider-refusal.ts).
const REFUSAL = '403 "message": "Request rejected in accordance with our terms of use and policies."';

test("a refusal is never treated as quota exhaustion, so nothing waits for it to clear", () => {
  expect(isQuotaExhaustionError([`all pool models exhausted: ${REFUSAL}`])).toBe(false);
  expect(isQuotaExhaustionError(["[llm-client] The model provider refused this request under its terms of use; it was not sent to any other model."])).toBe(false);
  expect(isQuotaExhaustionError(["all pool models exhausted: 429 RESOURCE_EXHAUSTED"])).toBe(true);
});
