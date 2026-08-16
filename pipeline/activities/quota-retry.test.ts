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
    {
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      // Always-healthy stub — this test is about the retry COUNT/backoff
      // cap, not health gating, so keep it behaving exactly as before the
      // health-check gate was added (see the dedicated health-gating tests
      // below for that behavior).
      healthCheckFn: async () => true,
    },
  );
  expect(result.success).toBe(false);
  expect(calls).toBe(3); // initial + 2 retries
  expect(sleeps).toEqual([90_000, 90_000]);
});

// 2026-08-16: health-gated retry (token-waste-reduction plan, Task 2).
// runGeneratorWithQuotaRetry used to blindly resend the full stored
// conversation history after a fixed 90s sleep, even when the circuit
// breaker was almost certainly still open. It now mirrors
// runWithQuotaWatchAndResume's pattern: after the existing 90s sleep, run
// a cheap health check BEFORE paying for the expensive resend — but stays
// bounded by the EXISTING MAX_GENERATOR_QUOTA_RETRIES/backoff budget
// rather than adopting runWithQuotaWatchAndResume's longer ~2h horizon.

test("runGeneratorWithQuotaRetry checks health after the sleep and before any retry attempt, in that order", async () => {
  const order: string[] = [];
  let attemptCount = 0;
  await runGeneratorWithQuotaRetry(
    async () => {
      attemptCount++;
      order.push("attempt");
      return attemptCount === 1
        ? { success: false, errors: ["all pool models exhausted"] }
        : { success: true, errors: [] };
    },
    {
      sleepFn: async () => {
        order.push("sleep");
      },
      healthCheckFn: async () => {
        order.push("health");
        return true;
      },
    },
  );
  expect(order).toEqual(["attempt", "sleep", "health", "attempt"]);
});

test("runGeneratorWithQuotaRetry does NOT resend the full context via attempt() when the health check reports still-unhealthy", async () => {
  let calls = 0;
  let healthChecks = 0;
  const sleeps: number[] = [];
  const result = await runGeneratorWithQuotaRetry(
    async () => {
      calls++;
      return { success: false, errors: ["all pool models exhausted"] };
    },
    {
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      healthCheckFn: async () => {
        healthChecks++;
        return false; // still unhealthy every time
      },
    },
  );
  expect(result.success).toBe(false);
  // Only the initial attempt ever ran the expensive resend — both retry
  // slots were gated off because the health check never reported healthy.
  expect(calls).toBe(1);
  // A health check still happens on each existing retry slot (at the same
  // 90s mark) — it's WHETHER attempt() runs that's gated, not whether the
  // slot/sleep happens at all.
  expect(healthChecks).toBe(2);
  // Critically: no extra waiting was added beyond the function's existing
  // 2-retry/90s-backoff budget.
  expect(sleeps).toEqual([90_000, 90_000]);
});

test("runGeneratorWithQuotaRetry still resumes and succeeds when the health check reports healthy — no regression to the working case", async () => {
  let calls = 0;
  let healthChecks = 0;
  const sleeps: number[] = [];
  const result = await runGeneratorWithQuotaRetry(
    async () => {
      calls++;
      // First call fails on quota exhaustion; the health-gated resume
      // (after a healthy check) succeeds — modeling genuine recovery.
      return calls === 1 ? { success: false, errors: ["RESOURCE_EXHAUSTED"] } : { success: true, errors: [] };
    },
    {
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      healthCheckFn: async () => {
        healthChecks++;
        return true;
      },
    },
  );
  expect(result.success).toBe(true);
  expect(calls).toBe(2); // initial failure + one healthy-gated resume
  expect(healthChecks).toBe(1);
  expect(sleeps).toEqual([90_000]); // only one retry slot was needed
});

test("runGeneratorWithQuotaRetry recovers mid-budget: unhealthy on the first retry slot, healthy on the second", async () => {
  let calls = 0;
  let healthChecks = 0;
  const result = await runGeneratorWithQuotaRetry(
    async () => {
      calls++;
      return calls === 1
        ? { success: false, errors: ["all pool models exhausted"] }
        : { success: true, errors: [] };
    },
    {
      sleepFn: async () => {},
      healthCheckFn: async () => {
        healthChecks++;
        return healthChecks >= 2; // unhealthy first check, healthy second
      },
    },
  );
  expect(result.success).toBe(true);
  expect(calls).toBe(2); // initial attempt + the one resume that followed a healthy check
  expect(healthChecks).toBe(2);
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
