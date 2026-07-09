import { test, expect } from "bun:test";
import {
  geminiChat,
  isRetryableGeminiStatus,
  geminiRetryDelayMs,
  resolveGeminiModel,
  resolveGeminiLocation,
  translateNimToolToGeminiTool,
  partsToText,
  partsToToolCalls,
  GEMINI_ESCALATION_MODEL,
} from "./gemini.ts";
import type { NimToolDef } from "./nim.ts";

test("resolveGeminiModel returns the default when GEMINI_MODEL is unset", () => {
  delete process.env.GEMINI_MODEL;
  expect(resolveGeminiModel()).toBe(GEMINI_ESCALATION_MODEL);
});

test("resolveGeminiModel honors a GEMINI_MODEL override", () => {
  process.env.GEMINI_MODEL = "gemini-3-pro";
  expect(resolveGeminiModel()).toBe("gemini-3-pro");
  delete process.env.GEMINI_MODEL;
});

test("resolveGeminiLocation defaults to global (the confirmed-working endpoint)", () => {
  delete process.env.GEMINI_LOCATION;
  expect(resolveGeminiLocation()).toBe("global");
});

test("resolveGeminiLocation honors a GEMINI_LOCATION override", () => {
  process.env.GEMINI_LOCATION = "us-east5";
  expect(resolveGeminiLocation()).toBe("us-east5");
  delete process.env.GEMINI_LOCATION;
});

test("translateNimToolToGeminiTool converts name/description/parameters straight through", () => {
  const nimTool: NimToolDef = {
    type: "function",
    function: {
      name: "write_file",
      description: "Write a file",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  };
  expect(translateNimToolToGeminiTool(nimTool)).toEqual({
    name: "write_file",
    description: "Write a file",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  });
});

test("partsToText joins only text parts, ignoring functionCall/functionResponse parts", () => {
  const parts = [
    { text: "Here's the plan:" },
    { functionCall: { name: "read_file", args: { path: "a.ts" } } },
    { text: "Then I'll write the file." },
  ];
  expect(partsToText(parts)).toBe("Here's the plan:\nThen I'll write the file.");
});

test("partsToText returns empty string when there are no text parts", () => {
  expect(partsToText([{ functionCall: { name: "read_file", args: {} } }])).toBe("");
});

test("partsToToolCalls extracts functionCall parts with synthesized, stable ids per turn", () => {
  const parts = [
    { text: "calling two tools" },
    { functionCall: { name: "read_file", args: { path: "a.ts" } } },
    { functionCall: { name: "read_file", args: { path: "b.ts" } } },
  ];
  expect(partsToToolCalls(parts)).toEqual([
    { id: "read_file-0", name: "read_file", input: { path: "a.ts" } },
    { id: "read_file-1", name: "read_file", input: { path: "b.ts" } },
  ]);
});

test("partsToToolCalls returns an empty array when there are no functionCall parts", () => {
  expect(partsToToolCalls([{ text: "no tools here" }])).toEqual([]);
});

// Regression: geminiWebSearch/geminiChat/geminiChatWithTools must validate
// GOOGLE_CLOUD_PROJECT BEFORE calling GoogleAuth (which makes a real network
// round-trip to fetch an ADC token) — otherwise a missing-project error only
// surfaces after an unnecessary live auth call, and the failure is
// nondeterministic in environments without ADC configured (e.g. CI).
test("geminiChat rejects a missing GOOGLE_CLOUD_PROJECT before attempting any network call", async () => {
  const previous = process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  try {
    await expect(geminiChat([{ role: "user", content: "hi" }])).rejects.toThrow(/GOOGLE_CLOUD_PROJECT/);
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = previous;
  }
});

// 2026-07-09: real bug found live (stress-full-gemini6 run) — a transient
// 429 RESOURCE_EXHAUSTED from Deepika's one-shot QA call threw immediately
// and crashed the ENTIRE pipeline, discarding all the generation work that
// had already succeeded. The tool-calling loops (loop.ts/claude-loop.ts/
// gemini-loop.ts) already retry transient failures with backoff; this
// one-shot chat path (geminiChat/geminiChatWithTools/geminiWebSearch, used
// by agentChat for Navya/Karan/Deepika) had none of that resilience.
test("isRetryableGeminiStatus is true for 429 and 503, false for other statuses", () => {
  expect(isRetryableGeminiStatus(429)).toBe(true);
  expect(isRetryableGeminiStatus(503)).toBe(true);
  expect(isRetryableGeminiStatus(400)).toBe(false);
  expect(isRetryableGeminiStatus(404)).toBe(false);
  expect(isRetryableGeminiStatus(500)).toBe(false);
  expect(isRetryableGeminiStatus(200)).toBe(false);
});

test("geminiRetryDelayMs backs off exponentially by attempt number", () => {
  const d0 = geminiRetryDelayMs(0);
  const d1 = geminiRetryDelayMs(1);
  const d2 = geminiRetryDelayMs(2);
  expect(d1).toBeGreaterThan(d0);
  expect(d2).toBeGreaterThan(d1);
});
