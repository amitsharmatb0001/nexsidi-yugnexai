import { test, expect } from "bun:test";
import { estimateTokenCount, compactHistory, findSymbolInFile, estimateGeminiTokenCount, compactGeminiHistory } from "./compaction.ts";
import type { ClaudeMessage, GeminiMessage, NimMessage } from "@nexsidi/llm-client";
import { findNimPairingViolations, findClaudePairingViolations } from "./history-validate.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let mockChatCalled = false;

const mockChat = async () => {
  mockChatCalled = true;
  return { content: "TRIGGER: modified files\nACTION: completed summary" };
};

test("token estimation", () => {
  const messages: NimMessage[] = [
    { role: "system", content: "hello world" }, // 11 chars
    { role: "user", content: "test" },        // 4 chars
  ];
  // 15 chars / 4 = 3.75 -> rounded to 4
  expect(estimateTokenCount(messages)).toBe(4);
});

test("compactHistory no-op under 30K tokens", async () => {
  mockChatCalled = false;
  const messages: NimMessage[] = [
    { role: "system", content: "small" },
    { role: "user", content: "msg" },
  ];
  const result = await compactHistory(messages, mockChat);
  expect(result).toBe(messages);
  expect(mockChatCalled).toBe(false);
});

test("compactHistory triggers summarization over 30K tokens", async () => {
  mockChatCalled = false;
  // Generate a message large enough to cross 30K tokens (120,000+ characters)
  const hugeContent = "x".repeat(130000);
  const messages: NimMessage[] = [
    { role: "system", content: "system prompt" },
    { role: "user", content: "initial message" },
    { role: "assistant", content: "intermediate thought" },
    { role: "tool", tool_call_id: "call_1", content: hugeContent },
    { role: "assistant", content: "another thought" },
    { role: "tool", tool_call_id: "call_2", content: "small result" },
    { role: "user", content: "current query" },
    { role: "assistant", content: "final thought" },
  ];

  const result = await compactHistory(messages, mockChat);
  expect(mockChatCalled).toBe(true);
  expect(result.length).toBe(7); // system + initial + summarized + 4 trailing
  expect(result[2]!.content).toContain("completed summary");
});

// 2026-07-24 (W0.3, full agentic upgrade): compactHistory (NimMessage[]) was
// never wired into the Gemini tool-calling loops (gemini-loop.ts/qa-loop.ts)
// because it isn't shape-compatible with GeminiMessage (parts-based content,
// functionCall/functionResponse pairs that Gemini's API requires to stay
// adjacent — a naive slice(-N) can split a functionCall from its matching
// functionResponse, which the API rejects). qa-loop.ts had NO compaction of
// any kind; gemini-loop.ts only had a reactive 720K-token hard-drop that the
// measured runs (190-311K tokens) never reached. These tests define and
// pin the Gemini-shaped equivalent.

test("estimateGeminiTokenCount sums string content and part content (text/functionCall/functionResponse)", () => {
  const messages: GeminiMessage[] = [
    { role: "system", content: "hello world" }, // 11 chars
    { role: "user", content: "test" },           // 4 chars
    {
      role: "model",
      content: [{ functionCall: { name: "read_file", args: { path: "a.ts" } } }],
    },
  ];
  const withoutParts = estimateGeminiTokenCount(messages.slice(0, 2));
  const withParts = estimateGeminiTokenCount(messages);
  expect(withoutParts).toBe(4); // 15 chars / 4
  expect(withParts).toBeGreaterThan(withoutParts); // the functionCall part adds chars
});

test("compactGeminiHistory no-op under the token threshold", async () => {
  let called = false;
  const mockChat = async () => { called = true; return { content: "summary" }; };
  const messages: GeminiMessage[] = [
    { role: "system", content: "small" },
    { role: "user", content: "msg" },
  ];
  const result = await compactGeminiHistory(messages, mockChat, 40_000);
  expect(result).toBe(messages);
  expect(called).toBe(false);
});

test("compactGeminiHistory summarizes the middle and keeps system + trailing turns when over threshold", async () => {
  let called = false;
  const mockChat = async () => { called = true; return { content: "AGENT SUMMARY: wrote 3 files, fixed a null check" }; };

  const huge = "x".repeat(200_000); // ~50K tokens, well over a 40K threshold
  const messages: GeminiMessage[] = [
    { role: "system", content: "system prompt" },
    { role: "user", content: "initial task" },
    { role: "model", content: [{ text: huge }] },
    { role: "user", content: "continue" },
    { role: "model", content: [{ text: "ok working" }] },
    { role: "user", content: "status?" },
    { role: "model", content: [{ text: "almost done" }] },
    { role: "user", content: "keep going" },
    { role: "model", content: [{ text: "nearly there" }] },
    { role: "user", content: "finish it" },
  ];

  const result = await compactGeminiHistory(messages, mockChat, 40_000);
  expect(called).toBe(true);
  // system message preserved verbatim, first
  expect(result[0]).toEqual(messages[0]);
  // a compacted summary turn appears next, containing the mock summary text
  const summaryMsg = result[1] as { role: string; content: string };
  expect(summaryMsg.content).toContain("AGENT SUMMARY");
  // the final (most recent) trailing turn is preserved verbatim
  expect(result[result.length - 1]).toEqual(messages[messages.length - 1]);
  // net result is shorter than the original
  expect(result.length).toBeLessThan(messages.length);
});

test("compactGeminiHistory never splits a functionCall from its matching functionResponse turn", async () => {
  let called = false;
  const mockChat = async () => { called = true; return { content: "summary" }; };

  const huge = "x".repeat(200_000);
  // Construct history where a naive slice(-6) would land exactly between a
  // model turn's functionCall and the very next user turn's functionResponse
  // — the pairing-safety logic must extend the trailing slice backward to
  // keep both halves together, not send Gemini an orphaned functionResponse.
  const messages: GeminiMessage[] = [
    { role: "system", content: "system prompt" },
    { role: "user", content: "initial task" },
    { role: "model", content: [{ text: huge }] },   // padding to cross threshold
    { role: "user", content: "go" },
    { role: "model", content: [{ text: "working" }] },
    { role: "user", content: "still going" },
    // --- naive slice(-6) would start exactly here, splitting the pair below ---
    { role: "model", content: [{ functionCall: { name: "write_file", args: { path: "a.ts" } }, thoughtSignature: "sig-1" }] },
    { role: "user", content: [{ functionResponse: { name: "write_file", response: { status: "success" } } }] },
    { role: "model", content: [{ text: "done" }] },
  ];

  const result = await compactGeminiHistory(messages, mockChat, 40_000);
  expect(called).toBe(true);

  const hasFunctionResponse = (m: GeminiMessage) =>
    Array.isArray(m.content) && m.content.some((p) => "functionResponse" in p);
  const hasMatchingFunctionCall = (m: GeminiMessage) =>
    Array.isArray(m.content) && m.content.some((p) => "functionCall" in p);

  const responseIdx = result.findIndex(hasFunctionResponse);
  expect(responseIdx).toBeGreaterThan(0); // the functionResponse turn survived compaction
  // its immediately preceding turn must be the model's functionCall — never split
  expect(hasMatchingFunctionCall(result[responseIdx - 1]!)).toBe(true);
});

test("compactGeminiHistory falls back to a hard-drop summary (not a throw) when the summarizer call fails", async () => {
  const failingChat = async (): Promise<{ content: string }> => { throw new Error("model unavailable"); };
  const huge = "x".repeat(200_000);
  const messages: GeminiMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "start" },
    { role: "model", content: [{ text: huge }] },
    { role: "user", content: "a" },
    { role: "model", content: [{ text: "b" }] },
    { role: "user", content: "c" },
    { role: "model", content: [{ text: "d" }] },
    { role: "user", content: "e" },
    { role: "model", content: [{ text: "f" }] },
    { role: "user", content: "g" },
  ];
  const result = await compactGeminiHistory(messages, failingChat, 40_000);
  // must not throw, and must still shrink the history (fail-safe hard-drop)
  expect(result.length).toBeLessThan(messages.length);
});

test("findSymbolInFile finds class definition", () => {
  const code = `
    import fs from "fs";
    
    export class TaskController {
      async execute() {
        return 1;
      }
    }
  `;
  const tempDir = mkdtempSync(join(tmpdir(), "nexsidi-compaction-test-"));
  const tempFile = join(tempDir, "temp-code.ts");
  writeFileSync(tempFile, code, "utf-8");

  try {
    const result = findSymbolInFile(tempFile, "TaskController");
    expect(result).toContain("export class TaskController");
    expect(result).toContain("async execute()");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// 2026-08-27 (systematic audit of the GeminiPart-variant bug class — the same
// class as estimateGeminiTokenCount/capPart, both of which shipped this exact
// mistake). partsForSummaryPrompt branched on text/functionCall/
// functionResponse and defaulted everything else to `{ thought: true }`, so a
// screenshot reached the summarizer LLM labelled as an empty thought marker.
// Any conclusion that depended on having LOOKED at the app was therefore
// erased from the summary, silently.
test("compactGeminiHistory tells the summarizer a screenshot existed, never disguises it as a thought", async () => {
  let promptSeen = "";
  const mockChat = async (msgs: Array<{ role: string; content: string }>) => {
    promptSeen = msgs[0]!.content;
    return { content: "summary" };
  };
  const big = "x".repeat(200_000);
  // The image must land in the SUMMARIZED middle, not the raw trailing window
  // (safeTrailingSlice keeps the last 6 non-system turns verbatim, and a
  // middle of length 0 makes compaction a no-op).
  const filler: GeminiMessage[] = Array.from({ length: 8 }, (_, i) => ({ role: "user" as const, content: `turn ${i}` }));
  const messages: GeminiMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: [{ text: big }] },
    { role: "user", content: [{ text: "here is the page" }, { inlineData: { mimeType: "image/png", data: "AAAA" } }] },
    ...filler,
  ];

  await compactGeminiHistory(messages, mockChat, 1_000);

  // The summarizer must be able to see that an image was part of the run.
  expect(promptSeen).toContain("screenshot");
  expect(promptSeen).toContain("image/png");
  // And must never receive the raw base64 payload — that is the thing being
  // compacted away in the first place.
  expect(promptSeen).not.toContain("AAAA");
});

// ── 2026-09-26: NIM/Claude compactHistory bugs ───────────────────────────
// (1) claude-loop.ts passes Claude-shaped history (content = block arrays)
// into compactHistory, whose estimate read `content.length` = number of
// blocks: a ~50K-token history was estimated at 2 tokens, so the Claude
// escalation tier never compacted at all. (2) The fixed "last 4 messages"
// window could start on a tool result whose call was summarized away,
// which every provider's API rejects.

test("estimateTokenCount counts Claude blocks (was: 2 tokens for a ~50K-token history)", () => {
  const big = "x".repeat(200_000);
  const m = [
    { role: "system", content: "sys" }, { role: "user", content: "task" },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read_file", input: { path: "a.ts" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: big }] },
  ];
  expect(estimateTokenCount(m)).toBeGreaterThan(50_000);
});

test("estimateTokenCount prices a Claude image block at a fixed 1,600 tokens, not its base64 length", () => {
  const img = { type: "image", source: { type: "base64", media_type: "image/png", data: "A".repeat(400_000) } };
  const m = [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: [img] }] }];
  expect(estimateTokenCount(m)).toBe(1_600);
});

test("estimateTokenCount counts NIM tool_calls arguments", () => {
  const args = JSON.stringify({ path: "a.ts", content: "y".repeat(40_000) });
  const m: NimMessage[] = [{ role: "assistant", content: null, tool_calls: [{ id: "c", type: "function", function: { name: "write_file", arguments: args } }] }];
  expect(estimateTokenCount(m)).toBeGreaterThan(10_000);
});

test("compactHistory never starts the trailing window on an orphaned NIM tool result", async () => {
  const huge = "x".repeat(130_000);
  const m: NimMessage[] = [
    { role: "system", content: "sys" }, { role: "user", content: "task" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"a\"}" } }] },
    { role: "tool", tool_call_id: "c1", content: huge },
    { role: "assistant", content: null, tool_calls: [
      { id: "c2", type: "function", function: { name: "read_file", arguments: "{\"path\":\"b\"}" } },
      { id: "c3", type: "function", function: { name: "read_file", arguments: "{\"path\":\"c\"}" } },
    ] },
    { role: "tool", tool_call_id: "c2", content: "b" }, { role: "tool", tool_call_id: "c3", content: "c" },
    { role: "assistant", content: "done" }, { role: "user", content: "next" },
  ];
  const out = await compactHistory(m, mockChat);
  expect(findNimPairingViolations(out)).toEqual([]);
  expect(out.some((x) => x.role === "assistant" && x.tool_calls?.some((c) => c.id === "c2"))).toBe(true);
});

test("compactHistory on a Claude-shaped history compacts, stays paired, and sends no base64 to the summarizer", async () => {
  let prompt = "";
  const chat = async (msgs: Array<{ role: "user"; content: string }>) => { prompt = msgs[0]!.content; return { content: "SUMMARY" }; };
  const img = { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD".repeat(10) } };
  const big = "y".repeat(130_000);
  const m = [
    { role: "system", content: "sys" }, { role: "user", content: "task" },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "screenshot", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: big }, img] }] },
    { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "read_file", input: { path: "a" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "a" }] },
    { role: "assistant", content: [{ type: "tool_use", id: "t3", name: "read_file", input: { path: "b" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t3", content: "b" }] },
  ] as ClaudeMessage[];
  const out = await compactHistory(m, chat);
  expect(out.length).toBeLessThan(m.length);
  expect(findClaudePairingViolations(out)).toEqual([]);
  expect(prompt).not.toContain("QUJD");
  expect(prompt).toContain("[screenshot]");
});
