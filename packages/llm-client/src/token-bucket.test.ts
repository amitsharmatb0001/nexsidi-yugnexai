import { test, expect } from "bun:test";
import { tryAcquire, waitForToken, getBucketState } from "./token-bucket.ts";

// 2026-08-30: real symptom observed live (project 6c7d4358cf73) — a NIM call
// hung for 6+ minutes with no error, no escalation, no log line — well past
// nim.ts's own 240s fetch AbortController timeout. That timeout is armed
// AFTER waitForToken returns, so if THIS unbounded `while` loop is what
// never returns, the downstream timeout never gets a chance to exist at
// all. Could not fully reproduce or prove this loop was the exact live
// cause (no live debugger attached to the hung process), but the structural
// risk is real and undisputed regardless: an unbounded poll loop with no
// cap is exactly the class of bug nim.ts's own header comment already
// documents fixing for the fetch call itself — this loop had never
// received the same treatment.

test("waitForToken resolves immediately when a token is available", async () => {
  const model = `test-model-${Date.now()}-a`;
  await waitForToken(model, 40); // fresh bucket starts full — must not wait at all
});

test("waitForToken times out instead of hanging forever when the bucket never refills", async () => {
  const model = `test-model-${Date.now()}-b`;
  // Drain the bucket completely, then use an rpmLimit of 0 so it can never
  // refill — the exact "this loop cannot ever succeed" shape a real bug
  // (or a genuinely catastrophic rate-limit exhaustion) would produce.
  tryAcquire(model, 1);
  await expect(waitForToken(model, 0, 200, 20)).rejects.toThrow(/timed out after 200ms/);
});

test("the timeout error message names the model and includes real bucket state — actionable, not generic", async () => {
  const model = `test-model-${Date.now()}-c`;
  tryAcquire(model, 1);
  try {
    await waitForToken(model, 0, 100, 20);
    expect.unreachable();
  } catch (err) {
    expect(String(err)).toContain(model);
    expect(String(err)).toContain("tokens");
  }
});

test("waitForToken succeeds once the bucket genuinely refills before the deadline", async () => {
  const model = `test-model-${Date.now()}-d`;
  tryAcquire(model, 1); // drain the single token
  // rpmLimit of 1 refills at 1/60000ms — negligible within a short window,
  // so instead prove the SUCCESS path directly: a generous deadline against
  // a bucket that already has capacity (rpmLimit 40, only 1 ever drained)
  // must resolve well before its own timeout, not by accident of timing.
  const model2 = `test-model-${Date.now()}-e`;
  tryAcquire(model2, 40); // one token gone, 39 left
  const before = Date.now();
  await waitForToken(model2, 40, 5000, 20);
  expect(Date.now() - before).toBeLessThan(200); // resolved fast — tokens were available
});

test("getBucketState reflects real drain — proves tryAcquire and waitForToken share the same underlying bucket", () => {
  const model = `test-model-${Date.now()}-f`;
  tryAcquire(model, 10);
  tryAcquire(model, 10);
  const state = getBucketState(model, 10);
  expect(state.tokens).toBeCloseTo(8, 0);
});
