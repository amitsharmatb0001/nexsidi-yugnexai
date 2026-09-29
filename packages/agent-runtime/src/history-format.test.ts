import { test, expect } from "bun:test";
import { isGeminiHistory, isNimHistory } from "./history-format.ts";
import { estimateGeminiChars } from "./compaction.ts";

// 2026-09-28: real crash (project a034f90ba50e). The NIM loop and the Gemini
// loop persist an agent's conversation to the SAME agentConversations row
// (projectId + agentName) in different message formats. When the NIM run of
// tilotma-reality-checker escalated to Gemini, the Gemini loop loaded the
// NIM-format history (assistant turns with content: null + tool_calls) and
// crashed in estimateGeminiChars — killing a 71-minute deploy+review activity.
const nim = [
  { role: "system", content: "s" },
  { role: "user", content: "u" },
  { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "read_file", arguments: "{}" } }] },
  { role: "tool", tool_call_id: "1", content: "ok" },
];
const gemini = [
  { role: "system", content: "s" },
  { role: "user", content: "u" },
  { role: "model", content: [{ functionCall: { name: "read_file", args: {} } }] },
  { role: "user", content: [{ functionResponse: { name: "read_file", response: { ok: true } } }] },
];

test("history format checks tell the two loops' saved conversations apart", () => {
  expect(isGeminiHistory(gemini)).toBe(true);
  expect(isGeminiHistory(nim)).toBe(false);
  expect(isNimHistory(nim)).toBe(true);
  expect(isNimHistory(gemini)).toBe(false);
  expect(isGeminiHistory([{ role: "system", content: "s" }, { role: "user", content: "u" }])).toBe(true);
  expect(isNimHistory("not an array" as unknown as unknown[])).toBe(false);
});

test("estimateGeminiChars skips a message with no content instead of crashing", () => {
  expect(() => estimateGeminiChars(nim as never)).not.toThrow();
  expect(estimateGeminiChars([{ role: "user", content: "abcd" }, { role: "model", content: null as never }])).toBe(4);
});
