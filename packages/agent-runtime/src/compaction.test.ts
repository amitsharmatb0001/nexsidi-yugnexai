import { test, expect } from "bun:test";
import { estimateTokenCount, compactHistory, findSymbolInFile, estimateGeminiTokenCount, compactGeminiHistory } from "./compaction.ts";
import type { GeminiMessage, NimMessage } from "@nexsidi/llm-client";
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
