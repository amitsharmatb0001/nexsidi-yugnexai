import { test, expect, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import type { GeminiMessage } from "@nexsidi/llm-client";
import {
  isContextLengthExceededError,
  isUnrecoverableGeminiError,
  isAllPoolModelsExhaustedError,
  isQuotaExhaustionError,
  screenshotImagePathFor,
  isRelevantContextSelectionEnabled,
  COMPACTION_THRESHOLD_TOKENS,
} from "./gemini-loop.ts";
import { compactGeminiHistory, estimateGeminiTokenCount } from "./compaction.ts";
import { appendFactLedgerEntry, compactViaRelevantContext, type FactLedgerEntry } from "./context-selection.ts";

const source = readFileSync(new URL("./gemini-loop.ts", import.meta.url), "utf-8");

// 2026-07-25 (Phase 2.5.1, full MVP upgrade): no gemini-loop.ts test file
// existed at all before this — confirmed in .nexsidi/sdd/audit-2026-07-25.md
// as a gap: this is the loop that actually runs in production
// (GENERATOR_TIER=gemini), and it had zero direct test coverage. This file
// covers the two pure error-classification functions added/present here;
// the full agent loop itself still requires a live network call to exercise
// (same convention as router.ts's shouldUseGeminiForQA — the pure decision
// is unit-tested, the network call it gates is exercised by live runs).

test("isContextLengthExceededError recognizes Vertex's context-exceeded error shapes", () => {
  expect(isContextLengthExceededError(new Error("input token count (1200000) exceeds the maximum number of tokens allowed"))).toBe(true);
  expect(isContextLengthExceededError(new Error("Request exceeds the model's maximum context length"))).toBe(true);
  expect(isContextLengthExceededError(new Error("400 CONTEXT_LENGTH_EXCEEDED: too many tokens"))).toBe(true);
});

test("isContextLengthExceededError does not misclassify an unrelated error", () => {
  expect(isContextLengthExceededError(new Error("429 RESOURCE_EXHAUSTED"))).toBe(false);
  expect(isContextLengthExceededError(new Error("ECONNREFUSED"))).toBe(false);
  expect(isContextLengthExceededError(new Error("UNAUTHENTICATED: invalid credentials"))).toBe(false);
});

test("isUnrecoverableGeminiError and isContextLengthExceededError are mutually exclusive categories", () => {
  // A context-exceeded error must never ALSO be treated as unrecoverable
  // (it should trigger emergency compaction + retry, not an early abort) —
  // and vice versa.
  const contextErr = new Error("input token count exceeds the maximum number of tokens");
  expect(isContextLengthExceededError(contextErr)).toBe(true);
  expect(isUnrecoverableGeminiError(contextErr)).toBe(false);

  const authErr = new Error("UNAUTHENTICATED: no access token");
  expect(isUnrecoverableGeminiError(authErr)).toBe(true);
  expect(isContextLengthExceededError(authErr)).toBe(false);
});

// 2026-07-28: real bug found live — "screenshot"/"browser_screenshot" tool
// results carried only a text path ("Screenshot saved to X"); no image
// bytes ever reached a model, so every visual QA judgment was DOM/text-only.
// A build with sitewide corrupted-glyph text scored 7.47/10 against a 7.0
// pass bar as direct proof (.nexsidi/sdd/agent-autonomy-assessment-2026-07-26.md,
// F9). screenshotImagePathFor is the pure decision of whether/where to read
// image bytes from a tool result — the loop attaches them as an inlineData
// part right after the functionResponse for the same call.
test("screenshotImagePathFor returns the image path for a successful screenshot tool call", () => {
  expect(screenshotImagePathFor("screenshot", { status: "success", output: "/tmp/shot.png" })).toBe("/tmp/shot.png");
  expect(screenshotImagePathFor("browser_screenshot", { status: "success", output: "/tmp/shot2.png" })).toBe("/tmp/shot2.png");
});

test("screenshotImagePathFor returns null for a non-screenshot tool call", () => {
  expect(screenshotImagePathFor("read_file", { status: "success", output: "/tmp/shot.png" })).toBeNull();
});

test("screenshotImagePathFor returns null when the screenshot tool call itself failed", () => {
  expect(screenshotImagePathFor("screenshot", { status: "error", summary: "invalid URL" })).toBeNull();
});

test("screenshotImagePathFor returns null when result.output is missing or not a string", () => {
  expect(screenshotImagePathFor("screenshot", { status: "success" })).toBeNull();
  expect(screenshotImagePathFor("screenshot", { status: "success", output: 123 })).toBeNull();
});

// ── isAllPoolModelsExhaustedError ────────────────────────────────────────────
// 2026-08-04 (live, verify057463): real bug found live — the "design" tier's
// entire model pool (gemini-3.1-pro-preview AND gemini-3.6-flash) had their
// circuit breakers OPEN simultaneously. The generic catch-all error path
// (errors.push + sleep 5s + continue) treated this exactly like any single
// transient failure, so Aanya looped through all 60 iterations — each one
// guaranteed to fail identically, since a circuit that's OPEN doesn't clear
// itself in 5 seconds — burning ~8.3 minutes of wall-clock/iteration budget
// on a call that could never succeed. Detecting this specific shape lets the
// loop abort fast (matching isUnrecoverableGeminiError's existing pattern)
// instead of grinding to MAX_ITERATIONS.
test("isAllPoolModelsExhaustedError recognizes the routeToolsWithFallback all-models-exhausted shape", () => {
  const err = new Error(
    "[llm-client] routeToolsWithFallback(design) — all pool models exhausted:\n" +
      "  gemini-3.1-pro-preview: circuit breaker OPEN — skipped\n" +
      "  gemini-3.6-flash: circuit breaker OPEN — skipped",
  );
  expect(isAllPoolModelsExhaustedError(err)).toBe(true);
});

test("isAllPoolModelsExhaustedError is false for a single transient failure (fallback still available)", () => {
  const err = new Error("[Gemini gemini-3.1-pro-preview] 429: Resource exhausted");
  expect(isAllPoolModelsExhaustedError(err)).toBe(false);
});

test("isAllPoolModelsExhaustedError is false for an unrelated error", () => {
  expect(isAllPoolModelsExhaustedError(new Error("ECONNREFUSED"))).toBe(false);
});

// ── isQuotaExhaustionError ───────────────────────────────────────────────────
// 2026-08-05 (live, d709f34a800e): real bug found live — a full-pool-exhaustion
// GeneratorExhausted failure (the exact shape isAllPoolModelsExhaustedError
// detects above) was ALWAYS thrown nonRetryable:true by pipeline/activities/
// index.ts's generatorFailure, killing the entire workflow instantly instead
// of waiting out the same circuit-breaker cooldown stage6-deployment.ts's
// deployWithQuotaRetry already handles for the redeploy step. This is the
// shared check both now use — moved here (was previously duplicated only in
// stage6-deployment.ts) since generator activities need the identical logic.
test("isQuotaExhaustionError recognizes the exact GeneratorExhausted message shape", () => {
  expect(
    isQuotaExhaustionError([
      "Gemini call failed on iteration 9 — every model in the pool is circuit-broken, aborting early instead of grinding to MAX_ITERATIONS on a call that cannot succeed as-is: Error: [llm-client] routeToolsWithFallback(design) — all pool models exhausted:\ngemini-3.6-flash: 429 RESOURCE_EXHAUSTED",
    ]),
  ).toBe(true);
});

test("isQuotaExhaustionError returns false for a genuine generator error", () => {
  expect(isQuotaExhaustionError(["Agent stopped calling tools for 5 turns without calling task_complete"])).toBe(false);
});

test("isQuotaExhaustionError returns false for an empty errors list", () => {
  expect(isQuotaExhaustionError([])).toBe(false);
});

// 2026-08-05 (live, project 193c3080e582): the original no-tool-call nudge
// asked the model to "actually call the tool now" but never forbade
// re-reasoning — combined with core-reasoning.md's Rule 1 ("before doing
// anything, write three lines"), a weaker model responded to the
// correction by writing ANOTHER <thinking> block restating its plan
// instead of executing it, repeating until MAX_NO_TOOL_CALL_TURNS killed
// the whole generator. Confirms the strengthened nudge is actually wired,
// not just described in a comment.
test("the no-tool-call nudge explicitly forbids writing another thinking block", () => {
  expect(source).toContain("Do NOT write another <thinking> block restating or expanding your plan");
});

// ── Cost-control Task 4: lowered threshold + selectRelevantContext as the ──
// primary compaction path ────────────────────────────────────────────────
//
// Root cause being guarded against here: the 2026-07-24 "amnesiac
// oscillation" bug — lowering the threshold is only safe because Task 2's
// fact ledger (context-selection.ts) is what actually runs when the
// threshold is crossed now, not the old lossy prose summarizer. Every test
// below is exercised WITHOUT a live network call (compactViaRelevantContext
// and selectRelevantContext are pure), matching this file's existing
// convention of testing the pure decision logic directly rather than the
// full network-calling loop.

test("COMPACTION_THRESHOLD_TOKENS was lowered well below the old 750K value, and stays under the plan's 150K/call target", () => {
  expect(COMPACTION_THRESHOLD_TOKENS).toBeLessThan(750_000);
  expect(COMPACTION_THRESHOLD_TOKENS).toBeLessThanOrEqual(150_000);
  expect(COMPACTION_THRESHOLD_TOKENS).toBeGreaterThan(0);
});

test("isRelevantContextSelectionEnabled defaults to true and respects RELEVANT_CONTEXT_SELECTION_ENABLED=false", () => {
  const original = process.env.RELEVANT_CONTEXT_SELECTION_ENABLED;
  try {
    delete process.env.RELEVANT_CONTEXT_SELECTION_ENABLED;
    expect(isRelevantContextSelectionEnabled()).toBe(true);
    process.env.RELEVANT_CONTEXT_SELECTION_ENABLED = "false";
    expect(isRelevantContextSelectionEnabled()).toBe(false);
    process.env.RELEVANT_CONTEXT_SELECTION_ENABLED = "true";
    expect(isRelevantContextSelectionEnabled()).toBe(true);
  } finally {
    if (original === undefined) delete process.env.RELEVANT_CONTEXT_SELECTION_ENABLED;
    else process.env.RELEVANT_CONTEXT_SELECTION_ENABLED = original;
  }
});

test("both primary compaction call sites are wired to compactViaRelevantContext, gated by the escape hatch, with compactGeminiHistory reserved for the escape-hatch revert and the emergency context-exceeded path only", () => {
  // The two call sites this task rewires (on DB load, and before every
  // model call in the iteration loop) must use compactViaRelevantContext
  // when the lever is enabled.
  const primarySiteCount = (source.match(/compactViaRelevantContext\(/g) ?? []).length;
  expect(primarySiteCount).toBe(2);

  // compactGeminiHistory must still appear exactly twice: once as the
  // escape-hatch's full-revert fallback shared by both primary call sites
  // (LEGACY_COMPACTION_THRESHOLD_TOKENS), and once as the genuine
  // context-length-exceeded emergency recovery. It must NOT be called with
  // the new low COMPACTION_THRESHOLD_TOKENS directly anywhere — that would
  // be "run the lossy summarizer frequently," the exact bug this task exists
  // to avoid.
  const legacyCallCount = (source.match(/compactGeminiHistory\(messages, undefined, LEGACY_COMPACTION_THRESHOLD_TOKENS\)/g) ?? []).length;
  expect(legacyCallCount).toBe(2);
  expect(source).not.toContain("compactGeminiHistory(messages, undefined, COMPACTION_THRESHOLD_TOKENS)");
});

// ── The critical regression proof: reuses context-selection.test.ts's ──────
// "fact recorded early survives many turns later" pattern, scaled up to the
// exact shape of the incident this task fixes — a single call that would
// previously have carried 500K+ tokens.

function bigModelTurn(turn: number, sizeTokensApprox: number): GeminiMessage {
  // ~4 chars/token (estimateGeminiTokenCount's own approximation) — pads a
  // turn out to a realistic "large tool output" size (e.g. a sizeable
  // generated file or command output) rather than a tiny placeholder, so the
  // simulated history genuinely reaches incident-scale token counts.
  const filler = "x".repeat(sizeTokensApprox * 4);
  return { role: "model", content: [{ text: `Turn ${turn}: ${filler}` }] };
}
function ackTurn(turn: number): GeminiMessage {
  return { role: "user", content: `Turn ${turn}: ack` };
}

test("a run that previously would have hit 500K+ tokens on a single call now stays under the new ceiling via compactViaRelevantContext, without losing any fact-ledger entry", async () => {
  const fullHistory: GeminiMessage[] = [{ role: "system", content: "You are Shubham, the backend generator." }];
  let ledger: FactLedgerEntry[] = [];

  // Turn 5: the fact that must survive — a real decision (bcryptjs -> bcrypt)
  // recorded early in the session, matching context-selection.test.ts's
  // existing regression test for the identical bug class.
  fullHistory.push({ role: "model", content: [{ text: "Turn 5: editing backend/package.json to replace bcryptjs with bcrypt" }] });
  fullHistory.push(ackTurn(5));
  ledger = appendFactLedgerEntry(ledger, 5, [
    { toolName: "edit_file", args: { path: "backend/package.json", old_str: "bcryptjs", new_str: "bcrypt" }, result: { status: "success" } },
  ]);

  // Turns 6-45: large, routine tool-output-shaped turns — enough to genuinely
  // reach 500K+ tokens raw, reproducing the incident's single-call size
  // (docs/nexsidi/plans/2026-08-11-cost-control.md: "a single call tonight
  // sent 540,000+ input tokens").
  for (let turn = 6; turn <= 45; turn++) {
    fullHistory.push(bigModelTurn(turn, 15000));
    fullHistory.push(ackTurn(turn));
  }

  const rawTokens = estimateGeminiTokenCount(fullHistory);
  expect(rawTokens).toBeGreaterThan(500_000); // reproduces the incident's single-call scale

  // Sanity check on the OLD regime: under the legacy 750K threshold, this
  // history would NOT have been compacted at all (compactGeminiHistory
  // returns the identical reference when under threshold — compaction.ts:
  // `if (tokens < thresholdTokens) return messages`) — this is exactly how a
  // single call reached 540K+ tokens in the real incident: nothing fired.
  const uncompactedUnderLegacyThreshold = await compactGeminiHistory(fullHistory, undefined, 750_000);
  expect(uncompactedUnderLegacyThreshold).toBe(fullHistory); // same reference = no-op, confirming it would NOT have triggered

  // Now the actual fix: compactViaRelevantContext at the new, much lower
  // threshold rebuilds the context from the fact ledger instead.
  const compacted = compactViaRelevantContext(fullHistory, "Continue implementing the auth routes", ledger, COMPACTION_THRESHOLD_TOKENS);
  const compactedTokens = estimateGeminiTokenCount(compacted);

  expect(compactedTokens).toBeLessThan(150_000); // the plan's explicit "under 150K per call" target
  expect(compactedTokens).toBeLessThan(rawTokens); // real trimming happened, not a no-op

  // No fact lost: the turn-5 decision must still be present...
  const serialized = JSON.stringify(compacted);
  expect(serialized).toContain("bcryptjs");
  expect(serialized).toContain("bcrypt");

  // ...specifically via the fact ledger, not because turn 5's raw message
  // happened to survive in the trailing window (it's 40 turns back — long
  // gone from any reasonable trailing window).
  expect(serialized).not.toContain("editing backend/package.json to replace bcryptjs with bcrypt");
  expect(serialized).toContain("FACT LEDGER");
});

test("touched files sent to selectRelevantContext come from the fact ledger's file_written entries, not a separately tracked list", async () => {
  let ledger: FactLedgerEntry[] = [];
  ledger = appendFactLedgerEntry(ledger, 1, [
    { toolName: "write_file", args: { path: "backend/src/routes/auth.ts", content: "x" }, result: { status: "success" } },
  ]);
  ledger = appendFactLedgerEntry(ledger, 2, [
    { toolName: "run_command", args: { command: "bun test" }, result: { status: "error", summary: "1 failure" } },
  ]);

  const fullHistory: GeminiMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "start" },
  ];
  // Force compaction regardless of size by passing thresholdTokens = 0.
  const compacted = compactViaRelevantContext(fullHistory, "task", ledger, 0);
  const serialized = JSON.stringify(compacted);

  expect(serialized).toContain("TOUCHED FILES");
  expect(serialized).toContain("backend/src/routes/auth.ts");
  // The failed run_command's `file` field (the command string) must NOT leak
  // into TOUCHED FILES — it is a decision entry, not a file_written entry.
  expect(serialized).not.toContain("- bun test");
});

afterEach(() => {
  delete process.env.RELEVANT_CONTEXT_SELECTION_ENABLED;
});
