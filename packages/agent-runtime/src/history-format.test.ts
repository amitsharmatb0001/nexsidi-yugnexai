import { test, expect } from "bun:test";
import { isGeminiHistory, isNimHistory, resumesSavedHistory } from "./history-format.ts";
import { estimateGeminiChars } from "./compaction.ts";
import { readFileSync } from "node:fs";

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

// 2026-09-29: real bug (project a034f90ba50e). The review judges resumed their
// saved conversation from the PREVIOUS review round: the reality checker
// loaded 85 old messages and re-issued its old READY verdict in 2 iterations
// without looking at the freshly redeployed app (the evidence collector
// resumed 276 messages, the live design review 54). A judge must grade the
// build in front of it (D26: fresh-context evaluator), so judges start fresh.
test("an agent resumes its saved history unless it is a fresh-start agent", () => {
  expect(resumesSavedHistory({ projectId: "a034f90ba50e" })).toBe(true);
  expect(resumesSavedHistory({ projectId: "a034f90ba50e", freshStart: true })).toBe(false);
  expect(resumesSavedHistory({})).toBe(false);
});

test("every agent loop decides history resumption through resumesSavedHistory", () => {
  for (const file of ["loop.ts", "gemini-loop.ts", "claude-loop.ts"]) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf-8");
    expect(source).toContain("if (resumesSavedHistory(config)) {");
  }
});

test("every review judge is a fresh-start agent", () => {
  const tier3 = readFileSync(new URL("../../../agents/tilotma/src/tier3-review.ts", import.meta.url), "utf-8");
  const liveEval = readFileSync(new URL("../../../agents/tilotma/src/live-eval.ts", import.meta.url), "utf-8");
  expect((tier3.match(/freshStart: true/g) ?? []).length).toBe(2); // evidence collector + reality checker
  expect((liveEval.match(/freshStart: true/g) ?? []).length).toBe(2); // the evaluation + its one follow-up for missing scores
});
