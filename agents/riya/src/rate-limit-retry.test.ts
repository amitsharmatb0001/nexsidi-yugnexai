import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { postJsonWaitingOutRateLimit } from "./index.ts";

// 2026-10-25 (brewline2): the deploy's live check registered a test account and the app's own sign-up limiter answered
// 429 "Too many requests" (the earlier checks of the same deploy had used the minute's attempts), so the whole deploy was
// reported as failed and the build escalated. A 429 with a Retry-After is the app working as designed; the check waits out
// the window and tries again, a few times, the way the review account helper already does.

const reply = (status: number, headers: Record<string, string> = {}, body = "{}") => new Response(body, { status, headers });

test("a 429 is waited out for the time the app says and the request is repeated", async () => {
  const calls: string[] = [];
  const waits: number[] = [];
  const answers = [reply(429, { "retry-after": "7" }), reply(201, {}, '{"success":true}')];
  const res = await postJsonWaitingOrdered();
  async function postJsonWaitingOrdered() {
    return postJsonWaitingOutRateLimit("http://x/api/v1/auth/sign-up", { a: 1 }, {
      fetchFn: async (url, init) => { calls.push(`${init?.method} ${String(url)}`); return answers.shift()!; },
      sleep: async (ms) => { waits.push(ms); },
    });
  }
  expect(res.status).toBe(201);
  expect(calls.length).toBe(2);
  expect(waits).toEqual([8000]); // Retry-After 7 s plus a second
});

test("without a Retry-After it waits a minute, gives up after 3 tries and returns the last answer", async () => {
  const waits: number[] = [];
  let n = 0;
  const res = await postJsonWaitingOutRateLimit("http://x/y", {}, {
    fetchFn: async () => { n++; return reply(429, {}, '{"error":"Too many requests"}'); },
    sleep: async (ms) => { waits.push(ms); },
  });
  expect(res.status).toBe(429);
  expect(n).toBe(3);
  expect(waits).toEqual([61_000, 61_000]);
});

test("other statuses are returned at once, and a thrown network error is not swallowed", async () => {
  const waits: number[] = [];
  const bad = await postJsonWaitingOutRateLimit("http://x/y", {}, { fetchFn: async () => reply(400), sleep: async (ms) => { waits.push(ms); } });
  expect(bad.status).toBe(400);
  expect(waits).toEqual([]);
  await expect(postJsonWaitingOutRateLimit("http://x/y", {}, { fetchFn: async () => { throw new Error("ECONNREFUSED"); }, sleep: async () => {} })).rejects.toThrow("ECONNREFUSED");
});

test("the test-account helper registers and signs in through it", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  const fn = src.slice(src.indexOf("async function registerAndLoginTestUser"), src.indexOf("async function registerAndLoginTestUser") + 5000);
  expect((fn.match(/postJsonWaitingOutRateLimit\(/g) ?? []).length).toBe(2);
});
