import { test, expect, afterEach, afterAll } from "bun:test";
import { fetchGeminiWithLocationFallback, clearModelsMissingInLocation } from "./gemini.ts";

// 2026-10-24 (Brewline root cause): after a 429 on the global endpoint the router retried in asia-southeast1, where
// gemini-3.1-pro-preview, gemini-3.6-flash and gemini-3.8-flash are not published: 36 calls failed with 404 (13 min lost),
// every time. Google's guidance for a 429 is to back off on the global endpoint. Now a 404 from the backup region is
// remembered for that model, the same request is retried on the primary with backoff (the call is not lost), and that
// model is never sent to that region again.

const originalFetch = global.fetch;
const originalDelay = process.env.GEMINI_RETRY_BASE_DELAY_MS;
process.env.GEMINI_RETRY_BASE_DELAY_MS = "1"; // the backoff itself is real; the test only shortens it
afterEach(() => {
  global.fetch = originalFetch;
  clearModelsMissingInLocation();
});
afterAll(() => {
  if (originalDelay === undefined) delete process.env.GEMINI_RETRY_BASE_DELAY_MS;
  else process.env.GEMINI_RETRY_BASE_DELAY_MS = originalDelay;
});

test("a model the backup region does not have: the call is retried on the primary, and the region is skipped next time", async () => {
  process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "test-project";
  let globalCalls = 0;
  const hits: string[] = [];
  global.fetch = (async (url: string) => {
    hits.push(url.includes("/locations/global/") ? "global" : "asia");
    if (url.includes("/locations/global/")) {
      globalCalls++;
      return globalCalls === 1 ? new Response("rate limited", { status: 429 }) : new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { code: 404, message: "Publisher model `gemini-3.8-flash` was not found" } }), { status: 404 });
  }) as unknown as typeof fetch;

  const first = await fetchGeminiWithLocationFallback("gemini-3.8-flash", "global", { contents: [] }, {}, new AbortController().signal, "test");
  expect(first.res.status).toBe(200);
  expect(first.location).toBe("global");
  expect(hits).toEqual(["global", "asia", "global"]);

  hits.length = 0;
  globalCalls = 0;
  const second = await fetchGeminiWithLocationFallback("gemini-3.8-flash", "global", { contents: [] }, {}, new AbortController().signal, "test");
  expect(second.res.status).toBe(200);
  expect(hits.includes("asia")).toBe(false);
});

test("a model the backup region does have still falls over to it on a 429", async () => {
  process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "test-project";
  global.fetch = (async (url: string) =>
    url.includes("/locations/global/") ? new Response("rate limited", { status: 429 }) : new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
  const r = await fetchGeminiWithLocationFallback("gemini-3.5-flash", "global", { contents: [] }, {}, new AbortController().signal, "test");
  expect(r.location).toBe("asia-southeast1");
});
