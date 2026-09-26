import { test, expect } from "bun:test";
import type { GeminiMessage, NimMessage, ClaudeMessage } from "@nexsidi/llm-client";
import { findGeminiPairingViolations, findNimPairingViolations, findClaudePairingViolations } from "./history-validate.ts";

const call = (id: string, name = "read_file") => ({ id, type: "function" as const, function: { name, arguments: "{}" } });

test("NIM: valid call/result sequence has no violations", () => {
  const m: NimMessage[] = [
    { role: "system", content: "s" }, { role: "user", content: "t" },
    { role: "assistant", content: null, tool_calls: [call("a"), call("b")] },
    { role: "tool", tool_call_id: "a", content: "1" }, { role: "tool", tool_call_id: "b", content: "2" },
  ];
  expect(findNimPairingViolations(m)).toEqual([]);
});

test("NIM: tool result whose call is not directly before it is a violation", () => {
  const m: NimMessage[] = [{ role: "user", content: "summary" }, { role: "tool", tool_call_id: "a", content: "1" }];
  expect(findNimPairingViolations(m)).toEqual(["tool result a at 1 has no matching call"]);
});

test("NIM: call with no result (not the last message) is a violation", () => {
  const m: NimMessage[] = [
    { role: "assistant", content: null, tool_calls: [call("a")] }, { role: "user", content: "next" },
  ];
  expect(findNimPairingViolations(m)).toEqual(["tool call a at 0 has no result"]);
});

test("Gemini: functionResponse turn must follow a model turn with the same call names in order", () => {
  const ok: GeminiMessage[] = [
    { role: "model", content: [{ functionCall: { name: "read_file", args: {} } }] },
    { role: "user", content: [{ functionResponse: { name: "read_file", response: {} } }] },
  ];
  const orphan: GeminiMessage[] = [{ role: "user", content: [{ functionResponse: { name: "read_file", response: {} } }] }];
  expect(findGeminiPairingViolations(ok)).toEqual([]);
  expect(findGeminiPairingViolations(orphan)).toEqual(["functionResponse turn at 0 does not follow a matching functionCall turn"]);
});

test("Gemini: a trailing screenshot part after the functionResponse does not break pairing", () => {
  const m: GeminiMessage[] = [
    { role: "model", content: [{ functionCall: { name: "browser_screenshot", args: {} } }] },
    { role: "user", content: [{ functionResponse: { name: "browser_screenshot", response: {} } }, { inlineData: { mimeType: "image/png", data: "AAAA" } }] },
  ];
  expect(findGeminiPairingViolations(m)).toEqual([]);
});

test("Gemini: an unanswered functionCall turn is fine only as the very last message", () => {
  const pending: GeminiMessage[] = [{ role: "model", content: [{ functionCall: { name: "read_file", args: {} } }] }];
  const broken: GeminiMessage[] = [...pending, { role: "user", content: "next" }];
  expect(findGeminiPairingViolations(pending)).toEqual([]);
  expect(findGeminiPairingViolations(broken)).toEqual(["functionCall turn at 0 is not answered by the next turn"]);
});

// Measured 2026-09-26 across every saved history (DB + disk): 346 unanswered
// Gemini calls, all of them task_complete followed by user text. The loop
// ends on task_complete without a functionResponse; a resumed run then
// appends a user message, and Gemini accepted those requests (the histories
// continue past them). Only that exact case is exempt.
test("Gemini: an unanswered task_complete at a run boundary is accepted; any other unanswered call is not", () => {
  const boundary: GeminiMessage[] = [
    { role: "model", content: [{ text: "Done." }, { functionCall: { name: "task_complete", args: { summary: "ok" } } }] },
    { role: "user", content: "Resume: fix the failing checks." },
  ];
  const otherTool: GeminiMessage[] = [
    { role: "model", content: [{ functionCall: { name: "http_request", args: {} } }] },
    { role: "user", content: "Resume." },
  ];
  expect(findGeminiPairingViolations(boundary)).toEqual([]);
  expect(findGeminiPairingViolations(otherTool)).toEqual(["functionCall turn at 0 is not answered by the next turn"]);
});

test("Claude: tool_result must answer a tool_use in the directly preceding assistant message", () => {
  const ok: ClaudeMessage[] = [
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read_file", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "x" }] },
  ];
  const orphan: ClaudeMessage[] = [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "x" }] }];
  expect(findClaudePairingViolations(ok)).toEqual([]);
  expect(findClaudePairingViolations(orphan)).toEqual(["tool_result t1 at 0 has no matching tool_use"]);
});
