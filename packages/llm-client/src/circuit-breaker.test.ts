import { test, expect } from "bun:test";
import { canRequest, recordFailure, recordSuccess, waitForCircuit, getState } from "./circuit-breaker.ts";

// 2026-07-11: real bug found live (stress-userupd-1783750047 run) — Gemini hit
// a burst of transient 429s, tripped the circuit to OPEN, then recovered (later
// iterations succeeded). But the NEXT unrelated call, made while the circuit
// was still OPEN, hit `canRequest() === false` and the caller (gemini.ts) threw
// immediately — killing 37 minutes of completed pipeline work over what the
// breaker's own design treats as a recoverable, self-healing condition (it
// auto-transitions to HALF_OPEN after OPEN_TIMEOUT_MS). waitForCircuit() closes
// that gap: instead of failing the instant the breaker is OPEN, wait out the
// remaining cooldown (bounded, never unbounded) and let the caller retry once.

test("waitForCircuit resolves immediately when the circuit is already CLOSED", async () => {
  const key = `test-closed-${Math.random()}`;
  const start = performance.now();
  await waitForCircuit(key, 5000);
  expect(performance.now() - start).toBeLessThan(100);
});

test("waitForCircuit waits out the remaining cooldown when OPEN, then allows a request", async () => {
  const key = `test-open-${Math.random()}`;
  for (let i = 0; i < 5; i++) recordFailure(key);
  expect(getState(key)).toBe("OPEN");
  expect(canRequest(key)).toBe(false);

  const start = performance.now();
  await waitForCircuit(key, 300); // short override so the test doesn't take 60s
  const elapsed = performance.now() - start;

  // Wide tolerance — setTimeout/event-loop scheduling jitter on shared CI
  // hosts, not the implementation, is what varies here.
  expect(elapsed).toBeGreaterThanOrEqual(200);
  expect(canRequest(key)).toBe(true); // HALF_OPEN probe now allowed
});

test("waitForCircuit does not wait a second time if the cooldown already elapsed", async () => {
  const key = `test-elapsed-${Math.random()}`;
  for (let i = 0; i < 5; i++) recordFailure(key);
  await new Promise((r) => setTimeout(r, 120));

  const start = performance.now();
  await waitForCircuit(key, 50); // cooldown (50ms) already elapsed by the time we call
  expect(performance.now() - start).toBeLessThan(50);
  expect(canRequest(key)).toBe(true);
});

test("a successful HALF_OPEN probe after waitForCircuit closes the breaker again", async () => {
  const key = `test-recover-${Math.random()}`;
  for (let i = 0; i < 5; i++) recordFailure(key);
  await waitForCircuit(key, 150);
  expect(canRequest(key)).toBe(true);
  recordSuccess(key);
  recordSuccess(key); // PROBE_SUCCESS_NEEDED = 2
  expect(getState(key)).toBe("CLOSED");
});
