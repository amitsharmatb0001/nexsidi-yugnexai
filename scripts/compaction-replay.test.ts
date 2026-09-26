import { test, expect } from "bun:test";
import type { GeminiMessage } from "@nexsidi/llm-client";
import { compactViaRelevantContext } from "../packages/agent-runtime/src/context-selection.ts";
import { measureCompaction } from "./compaction-replay.ts";

const turn = (name: string, args: Record<string, unknown>, response: Record<string, unknown>): GeminiMessage[] => [
  { role: "model", content: [{ functionCall: { name, args } }] },
  { role: "user", content: [{ functionResponse: { name, response } }] },
];

// A QA-style run: an unresolved POST error early on, a file read twice, and
// only unrelated successful calls after it — the fact ledger stays empty.
const history: GeminiMessage[] = [
  { role: "system", content: "sys" },
  { role: "user", content: "task" },
  ...turn("http_request", { method: "POST", url: "http://localhost:3001/api/tasks" }, { status: "error", summary: "500 Internal Server Error" }),
  ...turn("read_file", { path: "a.ts" }, { status: "success", output: "A1" }),
  ...turn("list_files", {}, { status: "success", output: "a.ts" }),
  ...turn("run_command", { command: "npx tsc --noEmit" }, { status: "success", output: "ok" }),
  ...turn("read_file", { path: "a.ts" }, { status: "success", output: "A2" }),
  ...turn("http_request", { method: "GET", url: "http://localhost:3001/health" }, { status: "success", output: "ok" }),
];

test("measureCompaction: nothing lost when nothing is compacted", () => {
  const m = measureCompaction(history, history);
  expect(m.callsBefore).toBe(6);
  expect(m.callsWithFullResultAfter).toBe(6);
  // newest successful copy per distinct call: read a.ts (A2), list_files, run_command, GET /health
  expect(m.latestResultsBefore).toBe(4);
  expect(m.latestResultsKept).toBe(4);
  expect(m.unresolvedErrorsBefore).toBe(1);
  expect(m.unresolvedErrorsKept).toBe(1);
  expect(m.pairingViolations).toEqual([]);
  expect(m.tokensAfter).toBe(m.tokensBefore);
});

test("measureCompaction shows today's compaction drops the unresolved error (empty fact ledger)", () => {
  const after = compactViaRelevantContext(history, "task", [], 1);
  const m = measureCompaction(history, after);
  expect(m.unresolvedErrorsBefore).toBe(1);
  expect(m.unresolvedErrorsKept).toBe(0);
  expect(m.callsWithFullResultAfter).toBeLessThan(m.callsBefore);
  expect(m.pairingViolations).toEqual([]);
});

test("an error followed by a later success on the same target is not counted as unresolved", () => {
  const resolved: GeminiMessage[] = [
    ...history,
    ...turn("http_request", { method: "POST", url: "http://localhost:3001/api/tasks", body: "{\"title\":\"x\"}" }, { status: "success", output: "201" }),
  ];
  expect(measureCompaction(resolved, resolved).unresolvedErrorsBefore).toBe(0);
});
