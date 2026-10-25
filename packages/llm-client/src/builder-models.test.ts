import { test, expect } from "bun:test";
import { poolForTier, rotatedPoolForAgent, poolStartingAt } from "./router.ts";

// 2026-10-24 (Amit: "for builder use all flash models", and pro for complex work): the builder tier keeps all four flash
// models, ordered by what Brewline measured — 3.5-flash 98% of calls ok (median 6.8 s), 3.6-flash 95% (5.6 s), 3.8-flash
// 73% (20.3 s), 3.7-flash 75% (30.1 s). Builder helpers run at the same time, so helper N starts on the Nth model and the
// rest stay as its fallbacks: all four flash models are used.

test("the builder tier keeps all four flash models, the most reliable first", () => {
  expect(poolForTier("generation")).toEqual(["gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash"]);
});

test("helper N starts on the Nth model of its tier; every model stays as a fallback", () => {
  const pool = poolForTier("generation");
  expect(poolStartingAt("generation", 0)[0]).toBe("gemini-3.5-flash");
  expect(poolStartingAt("generation", 1)[0]).toBe("gemini-3.6-flash");
  expect(poolStartingAt("generation", 2)[0]).toBe("gemini-3.7-flash");
  for (const i of [0, 1, 2]) expect([...poolStartingAt("generation", i)].sort()).toEqual([...pool].sort());
  expect(poolStartingAt("generation", 9)[0]).toBe(pool[9 % pool.length]);
});

test("the reviewers' separate first models are unchanged", () => {
  expect(rotatedPoolForAgent("qa", "karan")[0]).toBe(poolForTier("qa")[1]);
});
