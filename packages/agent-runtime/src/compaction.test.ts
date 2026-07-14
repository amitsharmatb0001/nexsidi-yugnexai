import { test, expect, mock } from "bun:test";
import { estimateTokenCount, compactHistory, findSymbolInFile } from "./compaction.ts";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

let mockChatCalled = false;

// Mock the chat client
mock.module("@nexsidi/llm-client", () => {
  return {
    geminiChat: async (messages: any[]) => {
      mockChatCalled = true;
      return { content: "TRIGGER: modified files\nACTION: completed summary" };
    },
  };
});

test("token estimation", () => {
  const messages = [
    { role: "system", content: "hello world" }, // 11 chars
    { role: "user", content: "test" },        // 4 chars
  ];
  // 15 chars / 4 = 3.75 -> rounded to 4
  expect(estimateTokenCount(messages)).toBe(4);
});

test("compactHistory no-op under 30K tokens", async () => {
  mockChatCalled = false;
  const messages = [
    { role: "system", content: "small" },
    { role: "user", content: "msg" },
  ];
  const result = await compactHistory(messages);
  expect(result).toBe(messages);
  expect(mockChatCalled).toBe(false);
});

test("compactHistory triggers summarization over 30K tokens", async () => {
  mockChatCalled = false;
  // Generate a message large enough to cross 30K tokens (120,000+ characters)
  const hugeContent = "x".repeat(130000);
  const messages = [
    { role: "system", content: "system prompt" },
    { role: "user", content: "initial message" },
    { role: "assistant", content: "intermediate thought" },
    { role: "tool", content: hugeContent },
    { role: "assistant", content: "another thought" },
    { role: "tool", content: "small result" },
    { role: "user", content: "current query" },
    { role: "assistant", content: "final thought" },
  ];

  const result = await compactHistory(messages);
  expect(mockChatCalled).toBe(true);
  expect(result.length).toBe(7); // system + initial + summarized + 4 trailing
  expect(result[2].content).toContain("completed summary");
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
  const tempFile = join(__dirname, "temp-code.ts");
  writeFileSync(tempFile, code, "utf-8");

  try {
    const result = findSymbolInFile(tempFile, "TaskController");
    expect(result).toContain("export class TaskController");
    expect(result).toContain("async execute()");
  } finally {
    try {
      unlinkSync(tempFile);
    } catch {}
  }
});
