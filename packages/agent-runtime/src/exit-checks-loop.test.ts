import { test, expect, mock, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 2026-10-24 (Brewline root cause): the frontend builder said "done" with emoji and missing colours still in its pages;
// the checks that find them ran only in the review. exitChecks runs the system's own checks when an agent calls
// task_complete: what they find goes back to the agent, and it may finish only when they are clean.
const real = await import("@nexsidi/llm-client");
const realRoute = real.routeToolsWithFallback;
let active = false;
let n = 0;
let sent: string[] = [];
mock.module("@nexsidi/llm-client", () => ({
  ...real,
  routeToolsWithFallback: async (...args: Parameters<typeof real.routeToolsWithFallback>) => {
    if (!active) return realRoute(...args);
    n++;
    sent.push(JSON.stringify(args[1]));
    const toolCalls = [{ id: `x${n}`, name: "task_complete", input: { summary: "done", files_written: [], verification_passed: true } }];
    return { content: "", toolCalls, stopReason: "STOP", modelUsed: "fake-model", promptTokens: 10, completionTokens: 5, rawParts: toolCalls.map((c) => ({ functionCall: { name: c.name, args: c.input } })) };
  },
}));
const { runAgentWithGemini } = await import("./gemini-loop.ts");
afterAll(() => {
  active = false;
});

test("finishing is refused while the system's checks find problems, and allowed once they are clean", async () => {
  const dir = mkdtempSync(join(tmpdir(), "exit-"));
  let checks = 0;
  n = 0;
  sent = [];
  active = true;
  try {
    const r = await runAgentWithGemini({
      agentName: "aanya", model: "meta/muse-glimmer-30b", apiKey: "x", systemPrompt: "s", initialMessage: "build", sandboxDir: dir, maxIterations: 4,
      skipEvidenceGate: true,
      exitChecks: () => (++checks === 1 ? ["frontend/app/menu/page.tsx: [emoji-ui] emoji are used as ui graphics on lines 12"] : []),
    });
    expect(n).toBe(2);
    expect(r.success).toBe(true);
    expect(sent[1]).toContain("the system's own checks found 1 problem(s)");
    expect(sent[1]).toContain("emoji are used as ui graphics");
  } finally {
    active = false;
    rmSync(dir, { recursive: true, force: true });
  }
});
