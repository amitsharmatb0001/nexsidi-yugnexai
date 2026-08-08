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

// 2026-08-06: real bug found live (project bae438767bed) — Tilotma's
// reality-checker (an evaluator, never told to fix anything) had
// write_file/run_command available anyway because these were granted
// unconditionally, and used them for 4 rounds of self-repair across its
// entire iteration budget instead of reporting the bug it found — producing
// zero findings for Stage 6 to route. readOnly closes this: the model must
// never even see the mutating tools as an option.
test("buildToolList omits every mutating tool when readOnly is set, even with enableDockerTools", () => {
  const tools = buildToolList({
    agentName: "x", model: "moonshotai/kimi-k2.6", apiKey: "k", systemPrompt: "s",
    initialMessage: "m", sandboxDir: "/tmp", enableDockerTools: true, readOnly: true,
  } as any);
  const names = tools.map(t => t.function.name);
  for (const blocked of ["write_file", "write_files", "edit_file", "delete_file", "run_command", "docker_compose"]) {
    expect(names).not.toContain(blocked);
  }
  // read-only tools must still be present
  expect(names).toContain("read_file");
  expect(names).toContain("list_files");
  expect(names).toContain("task_complete");
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

const noDiagnostics = async () => "";

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

test("evaluateCommandStrike passes a successful result through unchanged", async () => {
  const counter = createStrikeCounter();
  const result = { status: "success" as const, summary: "ok" };
  expect(await evaluateCommandStrike(counter, "npm test", result, noDiagnostics)).toEqual({ toolResult: result, exhausted: false });
});

test("evaluateCommandStrike leaves the result unchanged on the 1st and 2nd strike", async () => {
  const counter = createStrikeCounter();
  const result = { status: "error" as const, summary: "'npm test' exited 1", output: "Error: cannot find module 'foo'" };
  expect((await evaluateCommandStrike(counter, "npm test", result, noDiagnostics)).toolResult).toEqual(result);
  expect((await evaluateCommandStrike(counter, "npm test", result, noDiagnostics)).exhausted).toBe(false);
});

test("evaluateCommandStrike injects a forced-pivot instruction on the 3rd identical strike", async () => {
  const counter = createStrikeCounter();
  const result = { status: "error" as const, summary: "'npm test' exited 1", output: "Error: cannot find module 'foo'" };
  await evaluateCommandStrike(counter, "npm test", result, noDiagnostics);
  await evaluateCommandStrike(counter, "npm test", result, noDiagnostics);
  const third = await evaluateCommandStrike(counter, "npm test", result, noDiagnostics);
  expect(third.exhausted).toBe(false);
  expect(third.toolResult.next_actions).toContain("This approach failed 3 times with the same error. Do not retry it. Change approach fundamentally or call escalate.");
});

test("evaluateCommandStrike is exhausted on the 4th identical strike, after the pivot warning", async () => {
  const counter = createStrikeCounter();
  const result = { status: "error" as const, summary: "'npm test' exited 1", output: "Error: cannot find module 'foo'" };
  await evaluateCommandStrike(counter, "npm test", result, noDiagnostics);
  await evaluateCommandStrike(counter, "npm test", result, noDiagnostics);
  await evaluateCommandStrike(counter, "npm test", result, noDiagnostics);
  const fourth = await evaluateCommandStrike(counter, "npm test", result, noDiagnostics);
  expect(fourth.exhausted).toBe(true);
});

test("evaluateCommandStrike does not conflate different failures on the same command", async () => {
  const counter = createStrikeCounter();
  const errA = { status: "error" as const, summary: "'npm test' exited 1", output: "Error: cannot find module 'foo'" };
  const errB = { status: "error" as const, summary: "'npm test' exited 1", output: "Error: cannot find module 'bar'" };
  await evaluateCommandStrike(counter, "npm test", errA, noDiagnostics);
  await evaluateCommandStrike(counter, "npm test", errA, noDiagnostics);
  await evaluateCommandStrike(counter, "npm test", errA, noDiagnostics);
  // errB is a DIFFERENT failure signature — should not be exhausted yet
  expect((await evaluateCommandStrike(counter, "npm test", errB, noDiagnostics)).exhausted).toBe(false);
});
