import { test, expect, mock, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 2026-10-24 (Brewline root cause): the design agent's finished brief was rejected twice by the builders' completion gate
// ("no verification evidence this run"); it rewrote the brief as prose and the approved design was lost. An agent whose
// answer is the summary itself is now exempt (skipEvidenceGate); builders still are not.
const real = await import("@nexsidi/llm-client");
const realRoute = real.routeToolsWithFallback;
let active = false;
let n = 0;
mock.module("@nexsidi/llm-client", () => ({
  ...real,
  routeToolsWithFallback: async (...args: Parameters<typeof real.routeToolsWithFallback>) => {
    if (!active) return realRoute(...args);
    n++;
    const toolCalls = [{ id: `g${n}`, name: "task_complete", input: { summary: '{"mood":"warm"}', files_written: [], verification_passed: true } }];
    return { content: "", toolCalls, stopReason: "STOP", modelUsed: "fake-model", promptTokens: 10, completionTokens: 5, rawParts: toolCalls.map((c) => ({ functionCall: { name: c.name, args: c.input } })) };
  },
}));
const { runAgentWithGemini } = await import("./gemini-loop.ts");
afterAll(() => {
  active = false;
});

async function runWith(skip: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "seg-"));
  n = 0;
  active = true;
  try {
    return await runAgentWithGemini({ agentName: "vanya", model: "meta/muse-glimmer-30b", apiKey: "x", systemPrompt: "s", initialMessage: "brief", sandboxDir: dir, maxIterations: 3, readOnly: true, skipEvidenceGate: skip });
  } finally {
    active = false;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("with skipEvidenceGate the finished answer is accepted on the first call", async () => {
  const r = await runWith(true);
  expect(n).toBe(1);
  expect(r.success).toBe(true);
  expect(r.summary).toContain("warm");
});

test("without it, the evidence rule still applies (builders are unchanged)", async () => {
  const r = await runWith(false);
  expect(n).toBeGreaterThan(1);
  expect(r.success).toBe(false);
});
