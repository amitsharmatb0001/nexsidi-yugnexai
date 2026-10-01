import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { nimTimeBudgetMs, timeBudgetExceeded } from "./nim-time-budget.ts";

// Measured on project a034f90ba50e: successful NIM runs took 1-12 min (slowest
// 30); NIM runs that never finished burned 40-60 min before handing over to
// Gemini, which then finished in ~10.
test("defaults to 20 minutes, NIM_RUN_MAX_MINUTES overrides, 0 disables", () => {
  expect(nimTimeBudgetMs({})).toBe(20 * 60_000);
  expect(nimTimeBudgetMs({ NIM_RUN_MAX_MINUTES: "15" })).toBe(15 * 60_000);
  expect(nimTimeBudgetMs({ NIM_RUN_MAX_MINUTES: "0" })).toBe(0);
  expect(nimTimeBudgetMs({ NIM_RUN_MAX_MINUTES: "abc" })).toBe(20 * 60_000);
  expect(nimTimeBudgetMs({ NIM_RUN_MAX_MINUTES: "-5" })).toBe(20 * 60_000);
});

test("exceeded only past the budget, never when disabled", () => {
  expect(timeBudgetExceeded(0, 20 * 60_000, 20 * 60_000)).toBe(false);
  expect(timeBudgetExceeded(0, 20 * 60_000 + 1, 20 * 60_000)).toBe(true);
  expect(timeBudgetExceeded(0, 10 ** 12, 0)).toBe(false);
});

test("the NIM loop checks the budget each iteration, and only runAgentEscalated sets it", () => {
  const loop = readFileSync(new URL("./loop.ts", import.meta.url), "utf-8");
  const escalated = readFileSync(new URL("./claude-loop.ts", import.meta.url), "utf-8");
  expect(loop).toContain("timeBudgetExceeded(startedAt, Date.now(), config.timeBudgetMs ?? 0)");
  expect(escalated).toContain("deps.runNim({ ...config, timeBudgetMs: nimTimeBudgetMs() })");
});
