import { test, expect } from "bun:test";
import { isProviderRefusal } from "./provider-refusal.ts";
import { routeToolsWithFallback } from "./router.ts";

// 2026-10-22: Google answered every request with 403 "Request rejected in accordance with our terms of use and policies".
// The router sent the same refused request to every other model in the pool, the loop then called it "all pool models
// exhausted", and the build waited up to 2 hours re-checking. A refusal is not a quota limit: the system now stops at once,
// sends the refused request nowhere else, and says plainly that the model provider refused it.

const REFUSAL = '[Gemini gemini-4-argon] 403: { "error": { "code": 403, "message": "Request rejected in accordance with our terms of use and policies.", "status": "PERMISSION_DENIED" } }';

test("a terms-of-use refusal is recognised; other errors are not", () => {
  expect(isProviderRefusal(REFUSAL)).toBe(true);
  expect(isProviderRefusal('403 "status": "PERMISSION_DENIED" "reason": "SERVICE_DISABLED" API has not been used')).toBe(false);
  expect(isProviderRefusal("429 RESOURCE_EXHAUSTED")).toBe(false);
  expect(isProviderRefusal("AbortError: The operation was aborted.")).toBe(false);
});

test("after a refusal the router sends the request to no other model", async () => {
  const tried: string[] = [];
  await expect(routeToolsWithFallback("qa", [{ role: "user", content: "x" }], [], {}, {
    chat: async (_m, _t, o) => { tried.push(String(o?.model)); throw new Error(REFUSAL); },
  })).rejects.toThrow(/provider refused/i);
  expect(tried).toHaveLength(1);
});

test("the plain-chat path (spec, planning) also stops at a refusal", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("./router.ts", import.meta.url), "utf-8");
  const fn = src.slice(src.indexOf("export async function routeWithFallback"), src.indexOf("export async function routeToolsWithFallback"));
  expect(fn).toContain("if (isProviderRefusal(String(err))) throw new ProviderRefusalError(String(err));");
});
