import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { geminiTimeoutMsFor } from "./gemini.ts";

// 2026-10-24 (Brewline root cause): every call had the same 120 s limit. 43 calls died at exactly 120 s (86 min lost) —
// 23 of them the logic review, whose one call carries up to 600,000 characters of code. Successful review calls: median
// 42.6 s, p90 102 s, slowest 119.1 s — the distribution is cut off by the limit. The limit now grows with the request.

test("small calls keep 120 s; large ones get about 1.8 s per 1,000 tokens, up to 6 minutes", () => {
  expect(geminiTimeoutMsFor(20_000)).toBe(120_000);
  expect(geminiTimeoutMsFor(600_000)).toBe(270_000); // ~150k tokens: the one-pass review
  expect(geminiTimeoutMsFor(5_000_000)).toBe(360_000);
});

test("all three call paths use the size-based limit", () => {
  const src = readFileSync(new URL("./gemini.ts", import.meta.url), "utf-8");
  expect(src).not.toContain("setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)");
  expect((src.match(/setTimeout\(\(\) => controller\.abort\(\), geminiTimeoutMsFor\(/g) ?? []).length).toBe(3);
});
