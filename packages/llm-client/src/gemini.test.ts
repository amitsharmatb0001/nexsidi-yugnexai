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
  buildGeminiContents,
  formatUsageLog,
  GEMINI_ESCALATION_MODEL,
} from "./gemini.ts";
import type { NimToolDef } from "./nim.ts";
import type { GeminiMessage } from "./gemini.ts";

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

// 2026-07-24 (W0.3, full agentic upgrade): cachedContentTokenCount was never
// read from Vertex AI's usageMetadata anywhere in this file before this fix
// — a prompt-cache hit and a full-price miss were indistinguishable in the
// logs, so there was no way to observe whether the stable system-prompt /
// base-code-context prefix was ever actually being cached across the
// repeated calls a single agent run makes.
test("formatUsageLog reports plain usage when there is no cache hit", () => {
  expect(formatUsageLog({ promptTokenCount: 1000, candidatesTokenCount: 200, totalTokenCount: 1200 }))
    .toBe("usage: 1000 in / 200 out / 1200 total");
});

test("formatUsageLog surfaces cachedContentTokenCount when present and > 0", () => {
  expect(formatUsageLog({ promptTokenCount: 1000, candidatesTokenCount: 200, totalTokenCount: 1200, cachedContentTokenCount: 850 }))
    .toBe("usage: 1000 in / 200 out / 1200 total (850 cached)");
});

test("formatUsageLog omits the cache note when cachedContentTokenCount is 0", () => {
  expect(formatUsageLog({ promptTokenCount: 1000, candidatesTokenCount: 200, totalTokenCount: 1200, cachedContentTokenCount: 0 }))
    .toBe("usage: 1000 in / 200 out / 1200 total");
});

test("geminiRetryDelayMs backs off exponentially by attempt number", () => {
  const d0 = geminiRetryDelayMs(0);
  const d1 = geminiRetryDelayMs(1);
  const d2 = geminiRetryDelayMs(2);
  expect(d1).toBeGreaterThan(d0);
  expect(d2).toBeGreaterThan(d1);
});

// 2026-07-24 (NexSidi full agentic upgrade, W0.1): Gemini 3.x requires every
// multi-turn request to echo back the `thoughtSignature` the API attached to
// the FIRST functionCall part of a prior model turn — a missing signature on
// upgrade to gemini-3.6-flash/gemini-3.1-pro-preview is a hard 400, not a
// silent degradation. Before this fix, `GeminiPart`'s functionCall variant
// had no typed field for it (audit: docs/audit/2026-07-22-nexsidi-depth-audit.md)
// so any code constructing/inspecting a functionCall part could silently drop
// it. This locks the field into the type and proves it survives the full
// round trip: API response -> stored history -> next outgoing request body.
test("GeminiPart functionCall variant carries a typed thoughtSignature field", () => {
  const part: import("./gemini.ts").GeminiPart = {
    functionCall: { name: "write_file", args: { path: "a.ts" } },
    thoughtSignature: "opaque-signature-bytes",
  };
  expect(part.functionCall.name).toBe("write_file");
  expect(part.thoughtSignature).toBe("opaque-signature-bytes");
});

test("buildGeminiContents preserves thoughtSignature on a prior model turn's functionCall part", () => {
  const history: GeminiMessage[] = [
    { role: "system", content: "you are an agent" },
    { role: "user", content: "write a.ts" },
    {
      role: "model",
      content: [
        { functionCall: { name: "write_file", args: { path: "a.ts" } }, thoughtSignature: "sig-abc123" },
      ],
    },
    { role: "user", content: [{ functionResponse: { name: "write_file", response: { status: "success" } } }] },
  ];

  const { contents, systemParts } = buildGeminiContents(history);

  expect(systemParts).toEqual(["you are an agent"]);
  // The model turn's functionCall part must reach the outgoing request body
  // with thoughtSignature intact — this is what the API requires echoed back.
  const modelTurn = contents.find((c) => c.role === "model");
  expect(modelTurn).toBeDefined();
  const fcPart = modelTurn!.parts.find((p) => "functionCall" in p) as { thoughtSignature?: string } | undefined;
  expect(fcPart?.thoughtSignature).toBe("sig-abc123");
});

test("buildGeminiContents round-trips thoughtSignature through JSON.stringify (what actually goes over the wire)", () => {
  const history: GeminiMessage[] = [
    {
      role: "model",
      content: [{ functionCall: { name: "read_file", args: { path: "b.ts" } }, thoughtSignature: "sig-xyz789" }],
    },
  ];
  const { contents } = buildGeminiContents(history);
  const wireBody = JSON.parse(JSON.stringify({ contents }));
  expect(wireBody.contents[0].parts[0].thoughtSignature).toBe("sig-xyz789");
});
