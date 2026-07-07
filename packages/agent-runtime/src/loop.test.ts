import { test, expect } from "bun:test";
import { buildToolList, sanitizeToolCalls } from "./loop.ts";
import type { NimToolCall } from "@nexsidi/llm-client";

test("buildToolList excludes web_search and screenshot by default", () => {
  const tools = buildToolList({ agentName: "x", model: "moonshotai/kimi-k2.6", apiKey: "k", systemPrompt: "s", initialMessage: "m", sandboxDir: "/tmp" } as any);
  const names = tools.map(t => t.function.name);
  expect(names).not.toContain("web_search");
  expect(names).not.toContain("screenshot");
});

test("buildToolList includes web_search and screenshot when enabled", () => {
  const tools = buildToolList({ agentName: "x", model: "moonshotai/kimi-k2.6", apiKey: "k", systemPrompt: "s", initialMessage: "m", sandboxDir: "/tmp", enableWebSearch: true, enableScreenshot: true } as any);
  const names = tools.map(t => t.function.name);
  expect(names).toContain("web_search");
  expect(names).toContain("screenshot");
});

// Full-system audit T1/L1: an unparseable tool_call.function.arguments
// string that survives into `messages` history poisons every subsequent
// NIM request — confirmed via stress-test run 5, where the SAME JSON parse
// error ("Expecting ',' delimiter: line 1 column 837") replayed at the
// identical byte offset for 14 consecutive iterations. sanitizeToolCalls
// is the fix: called BEFORE pushing to history, not just at tool-execution
// time (which was already correct but too late — the damage to history
// was already done).
function makeCall(id: string, args: string): NimToolCall {
  return { id, type: "function", function: { name: "write_file", arguments: args } };
}

test("sanitizeToolCalls leaves well-formed tool calls completely unchanged", () => {
  const calls = [makeCall("1", JSON.stringify({ path: "a.ts", content: "x" }))];
  const { sanitized, malformedIds } = sanitizeToolCalls(calls);
  expect(sanitized).toEqual(calls);
  expect(malformedIds.size).toBe(0);
});

test("sanitizeToolCalls replaces malformed arguments with a safe empty object", () => {
  const calls = [makeCall("1", '{"path": "a.ts", "content": "unterminated')]; // truncated mid-string
  const { sanitized, malformedIds } = sanitizeToolCalls(calls);
  expect(sanitized[0]!.function.arguments).toBe("{}");
  expect(malformedIds.has("1")).toBe(true);
});

test("sanitizeToolCalls handles a mix of good and malformed calls independently", () => {
  const calls = [
    makeCall("good", JSON.stringify({ path: "a.ts", content: "x" })),
    makeCall("bad", "{not json{{{"),
  ];
  const { sanitized, malformedIds } = sanitizeToolCalls(calls);
  expect(sanitized[0]!.function.arguments).toBe(calls[0]!.function.arguments);
  expect(sanitized[1]!.function.arguments).toBe("{}");
  expect(malformedIds).toEqual(new Set(["bad"]));
});

test("sanitizeToolCalls preserves id/type/name — only arguments is ever touched", () => {
  const calls = [makeCall("1", "broken{{{")];
  const { sanitized } = sanitizeToolCalls(calls);
  expect(sanitized[0]!.id).toBe("1");
  expect(sanitized[0]!.type).toBe("function");
  expect(sanitized[0]!.function.name).toBe("write_file");
});
