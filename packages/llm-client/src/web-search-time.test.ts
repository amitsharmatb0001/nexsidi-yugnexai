import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { WEB_SEARCH_DEFAULT_TIMEOUT_MS, webSearchTimeoutMs, searchAbort } from "./gemini.ts";

// 2026-10-02 (Ledgerly benchmark run 3, decided by Amit): every web search
// was cut off at 10 s while a real Gemini search takes about 17 s — all 7
// searches in run 3 failed. Default is now 2 minutes and there is no hard
// maximum: an agent doing long, deep research asks for the time it needs.
// What ends a stuck search is the run being stopped (its abort signal).

test("a web search gets 2 minutes by default", () => {
  expect(WEB_SEARCH_DEFAULT_TIMEOUT_MS).toBe(120_000);
  expect(webSearchTimeoutMs()).toBe(120_000);
  expect(webSearchTimeoutMs(0)).toBe(120_000);
  expect(webSearchTimeoutMs(Number.NaN)).toBe(120_000);
});

test("an agent's requested time is used as given — no ceiling", () => {
  expect(webSearchTimeoutMs(600_000)).toBe(600_000);
  expect(webSearchTimeoutMs(3_600_000)).toBe(3_600_000);
});

test("stopping the run aborts a search in progress", () => {
  const run = new AbortController();
  const s = searchAbort(600_000, run.signal);
  expect(s.signal.aborted).toBe(false);
  run.abort();
  expect(s.signal.aborted).toBe(true);
  s.clear();
});

test("a search's own time limit still ends it", async () => {
  const s = searchAbort(20);
  await new Promise((r) => setTimeout(r, 60));
  expect(s.signal.aborted).toBe(true);
  s.clear();
});

test("geminiWebSearch has no hard-coded clamp left", () => {
  const src = readFileSync(new URL("./gemini.ts", import.meta.url), "utf-8");
  expect(src).not.toContain("Math.min(opts?.timeoutMs ?? 10_000, 30_000)");
});
