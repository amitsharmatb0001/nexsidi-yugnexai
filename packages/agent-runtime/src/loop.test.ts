import { test, expect } from "bun:test";
import { buildToolList, sanitizeToolCalls, evaluateCommandStrike } from "./loop.ts";
import { createStrikeCounter } from "./enforce/strikes.ts";
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

// Phase 5 Task 4: mechanical 3-strike escalation (Rule 7) for run_command
// failures. evaluateCommandStrike is the pure, directly-testable piece the
// loop calls on every failed run_command result — same pattern as
// sanitizeToolCalls (pure helper, no live network needed to test it).

test("evaluateCommandStrike passes a successful result through unchanged", () => {
  const counter = createStrikeCounter();
  const result = { status: "success" as const, summary: "ok" };
  expect(evaluateCommandStrike(counter, "npm test", result)).toEqual({ toolResult: result, exhausted: false });
});

test("evaluateCommandStrike leaves the result unchanged on the 1st and 2nd strike", () => {
  const counter = createStrikeCounter();
  const result = { status: "error" as const, summary: "'npm test' exited 1", output: "Error: cannot find module 'foo'" };
  expect(evaluateCommandStrike(counter, "npm test", result).toolResult).toEqual(result);
  expect(evaluateCommandStrike(counter, "npm test", result).exhausted).toBe(false);
});

test("evaluateCommandStrike injects a forced-pivot instruction on the 3rd identical strike", () => {
  const counter = createStrikeCounter();
  const result = { status: "error" as const, summary: "'npm test' exited 1", output: "Error: cannot find module 'foo'" };
  evaluateCommandStrike(counter, "npm test", result);
  evaluateCommandStrike(counter, "npm test", result);
  const third = evaluateCommandStrike(counter, "npm test", result);
  expect(third.exhausted).toBe(false);
  expect(third.toolResult.next_actions).toContain("This approach failed 3 times with the same error. Do not retry it. Change approach fundamentally or call escalate.");
});

test("evaluateCommandStrike is exhausted on the 4th identical strike, after the pivot warning", () => {
  const counter = createStrikeCounter();
  const result = { status: "error" as const, summary: "'npm test' exited 1", output: "Error: cannot find module 'foo'" };
  evaluateCommandStrike(counter, "npm test", result);
  evaluateCommandStrike(counter, "npm test", result);
  evaluateCommandStrike(counter, "npm test", result);
  const fourth = evaluateCommandStrike(counter, "npm test", result);
  expect(fourth.exhausted).toBe(true);
});

test("evaluateCommandStrike does not conflate different failures on the same command", () => {
  const counter = createStrikeCounter();
  const errA = { status: "error" as const, summary: "'npm test' exited 1", output: "Error: cannot find module 'foo'" };
  const errB = { status: "error" as const, summary: "'npm test' exited 1", output: "Error: cannot find module 'bar'" };
  evaluateCommandStrike(counter, "npm test", errA);
  evaluateCommandStrike(counter, "npm test", errA);
  evaluateCommandStrike(counter, "npm test", errA);
  // errB is a DIFFERENT failure signature — should not be exhausted yet
  expect(evaluateCommandStrike(counter, "npm test", errB).exhausted).toBe(false);
});
