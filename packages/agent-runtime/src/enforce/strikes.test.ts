import { test, expect } from "bun:test";
import { createStrikeCounter, buildFailureSignature } from "./strikes.ts";

// Phase 5 Task 4 (final-bundle/phase5-harness-enforcement-plan.md):
// mechanical 3-strike escalation (Rule 7). Three failures with the SAME
// signature -> the 3rd strike is when the loop injects a forced-pivot
// message ("stop retrying this, change approach"); a 4th failure with the
// SAME signature despite the pivot message -> exhausted, run terminates so
// runAgentEscalated fires exactly once with a logged reason.

test("first failure with a new signature returns strikes:1, not exhausted", () => {
  const counter = createStrikeCounter();
  expect(counter.recordFailure("npm test:Error: cannot find module")).toEqual({ strikes: 1, exhausted: false });
});

test("repeated failures with the SAME signature accumulate strikes", () => {
  const counter = createStrikeCounter();
  counter.recordFailure("sig-a");
  counter.recordFailure("sig-a");
  expect(counter.recordFailure("sig-a")).toEqual({ strikes: 3, exhausted: false });
});

test("the 4th failure with the same signature (after the 3rd-strike pivot warning) is exhausted", () => {
  const counter = createStrikeCounter();
  counter.recordFailure("sig-a");
  counter.recordFailure("sig-a");
  counter.recordFailure("sig-a");
  expect(counter.recordFailure("sig-a")).toEqual({ strikes: 4, exhausted: true });
});

test("different signatures do NOT accumulate against each other", () => {
  const counter = createStrikeCounter();
  counter.recordFailure("sig-a");
  counter.recordFailure("sig-a");
  expect(counter.recordFailure("sig-b")).toEqual({ strikes: 1, exhausted: false });
});

test("the strike limit is configurable", () => {
  const counter = createStrikeCounter(2);
  counter.recordFailure("sig-a");
  expect(counter.recordFailure("sig-a")).toEqual({ strikes: 2, exhausted: false });
  expect(counter.recordFailure("sig-a")).toEqual({ strikes: 3, exhausted: true });
});

test("a success for a signature resets its strike count", () => {
  const counter = createStrikeCounter();
  counter.recordFailure("sig-a");
  counter.recordFailure("sig-a");
  counter.recordSuccess("sig-a");
  expect(counter.recordFailure("sig-a")).toEqual({ strikes: 1, exhausted: false });
});

// ── buildFailureSignature ────────────────────────────────────────────────
test("buildFailureSignature combines the command and the FIRST line of stderr only", () => {
  const sig = buildFailureSignature("npx tsc --noEmit", "src/index.ts(4,7): error TS2304: Cannot find name 'Foo'.\nsrc/index.ts(9,3): error TS2304: Cannot find name 'Bar'.");
  expect(sig).toBe("npx tsc --noEmit :: src/index.ts(4,7): error TS2304: Cannot find name 'Foo'.");
});

test("buildFailureSignature is identical for the same command+first-error-line even if later output differs", () => {
  const a = buildFailureSignature("npm run build", "ERROR: Cannot find module 'foo'\nstack trace line 1\nstack trace line 2");
  const b = buildFailureSignature("npm run build", "ERROR: Cannot find module 'foo'\ncompletely different trailing noise");
  expect(a).toBe(b);
});

test("buildFailureSignature differs when the command differs, even with identical stderr", () => {
  const a = buildFailureSignature("npm test", "ERROR: same message");
  const b = buildFailureSignature("npm run build", "ERROR: same message");
  expect(a).not.toBe(b);
});

test("buildFailureSignature handles empty stderr without throwing", () => {
  expect(buildFailureSignature("npm test", "")).toBe("npm test :: ");
});
