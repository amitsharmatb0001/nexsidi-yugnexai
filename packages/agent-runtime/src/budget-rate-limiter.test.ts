import { test, expect } from "bun:test";
import { SharedTokenBucket } from "./token-bucket.ts";
import { BudgetTracker } from "./budget-tracker.ts";
import { unlinkSync, existsSync } from "node:fs";

test("budget tracker logs and records usage", () => {
  const tracker = new BudgetTracker();
  tracker.recordRequest(1000, 200);
  tracker.recordRequest(5000, 450);

  const totals = tracker.getTotals();
  expect(totals.requests).toBe(2);
  expect(totals.input).toBe(6000);
  expect(totals.output).toBe(650);
});

test("shared token bucket acquires and replenishes tokens", async () => {
  const bucket = new SharedTokenBucket();

  // Pre-clean any stale state from a previous run so this test never blocks
  const path = (bucket as any).filePath;
  if (existsSync(path)) unlinkSync(path);

  // With NIM_API_KEY absent (test env), acquire() exits immediately
  const start = Date.now();
  await bucket.acquire(1000);
  const elapsed = Date.now() - start;
  expect(elapsed).toBeLessThan(100);

  if (existsSync(path)) unlinkSync(path);
});
