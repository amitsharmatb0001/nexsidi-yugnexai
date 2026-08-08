import { test, expect } from "bun:test";
import { runGeneratorWithQuotaRetry, runWithQuotaWatchAndResume } from "./quota-retry.ts";

test("runGeneratorWithQuotaRetry returns immediately on success", async () => {
  let calls = 0;
  const result = await runGeneratorWithQuotaRetry(async () => {
    calls++;
    return { success: true, errors: [] };
  });
  expect(result.success).toBe(true);
  expect(calls).toBe(1);
});

test("runGeneratorWithQuotaRetry does not retry a non-quota failure", async () => {
  let calls = 0;
  const result = await runGeneratorWithQuotaRetry(async () => {
    calls++;
    return { success: false, errors: ["some genuine bug"] };
  });
  expect(result.success).toBe(false);
  expect(calls).toBe(1);
});

test("runGeneratorWithQuotaRetry retries a quota-shaped failure up to the cap then gives up", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const result = await runGeneratorWithQuotaRetry(
    async () => {
      calls++;
      return { success: false, errors: ["all pool models exhausted"] };
    },
    async (ms) => {
      sleeps.push(ms);
    },
  );
  expect(result.success).toBe(false);
  expect(calls).toBe(3); // initial + 2 retries
  expect(sleeps).toEqual([90_000, 90_000]);
});

// 2026-08-07: explicit user request, live (project bae438767bed) — Tier 3's
// evidence-collector/reality-checker and live-eval had zero quota retry;
// a single 429 aborted the whole stage, forcing a manual pipeline re-run 8
// times in one session. runWithQuotaWatchAndResume closes that gap with a
// longer-horizon, health-check-gated resume loop (see its header comment
// for the full "wait & retry ... watch every 5 min ... pick up where it
// left off" reasoning taken directly from the user's request).

test("runWithQuotaWatchAndResume returns immediately on success — no health check, no sleep", async () => {
  let calls = 0;
  let healthChecks = 0;
  const result = await runWithQuotaWatchAndResume(
    async () => {
      calls++;
      return { success: true, errors: [] };
    },
    { healthCheckFn: async () => { healthChecks++; return true; }, sleepFn: async () => {} },
  );
  expect(result.success).toBe(true);
  expect(calls).toBe(1);
  expect(healthChecks).toBe(0);
});

test("runWithQuotaWatchAndResume does not enter the watch loop for a non-quota failure", async () => {
  let calls = 0;
  let healthChecks = 0;
  const result = await runWithQuotaWatchAndResume(
    async () => {
      calls++;
      return { success: false, errors: ["a genuine bug, not quota"] };
    },
    { healthCheckFn: async () => { healthChecks++; return true; }, sleepFn: async () => {} },
  );
  expect(result.success).toBe(false);
  expect(calls).toBe(1);
  expect(healthChecks).toBe(0);
});

test("runWithQuotaWatchAndResume polls on the given interval, waits for a healthy check, then resumes and succeeds", async () => {
  let calls = 0;
  let healthChecks = 0;
  const sleeps: number[] = [];
  const result = await runWithQuotaWatchAndResume(
    async () => {
      calls++;
      // First call fails on quota exhaustion; the resumed call (after a
      // healthy check) succeeds — modeling real recovery.
      return calls === 1 ? { success: false, errors: ["RESOURCE_EXHAUSTED"] } : { success: true, errors: [] };
    },
    {
      pollIntervalMs: 1234,
      healthCheckFn: async () => {
        healthChecks++;
        // Unhealthy on the first poll, healthy on the second — proves the
        // loop keeps waiting rather than resuming prematurely.
        return healthChecks >= 2;
      },
      sleepFn: async (ms) => { sleeps.push(ms); },
    },
  );
  expect(result.success).toBe(true);
  expect(calls).toBe(2); // initial failure + one successful resume
  expect(healthChecks).toBe(2); // unhealthy once, then healthy
  expect(sleeps).toEqual([1234, 1234]);
});

test("runWithQuotaWatchAndResume gives up after maxPolls if it never recovers", async () => {
  let calls = 0;
  let healthChecks = 0;
  const result = await runWithQuotaWatchAndResume(
    async () => {
      calls++;
      return { success: false, errors: ["circuit-broken"] };
    },
    {
      maxPolls: 3,
      healthCheckFn: async () => { healthChecks++; return false; },
      sleepFn: async () => {},
    },
  );
  expect(result.success).toBe(false);
  expect(calls).toBe(1); // only the initial attempt — never healthy enough to resume
  expect(healthChecks).toBe(3);
});

test("runWithQuotaWatchAndResume keeps watching if a resumed attempt fails on quota exhaustion again", async () => {
  let calls = 0;
  const result = await runWithQuotaWatchAndResume(
    async () => {
      calls++;
      // Every attempt (initial + every resume) still hits quota exhaustion.
      return { success: false, errors: ["all pool models exhausted"] };
    },
    {
      maxPolls: 2,
      healthCheckFn: async () => true, // always reports healthy
      sleepFn: async () => {},
    },
  );
  expect(result.success).toBe(false);
  expect(calls).toBe(3); // initial + resume after poll 1 + resume after poll 2
});
