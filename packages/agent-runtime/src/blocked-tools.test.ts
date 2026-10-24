import { test, expect, mock, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { teamRunOverrides } from "./team-files.ts";

// 2026-10-24 (builder teams): rollback_workspace resets the whole project folder to its last checkpoint. With helpers
// working in the same folder at the same time, one helper's rollback would wipe the others' work. Team helpers and the
// shared-files step therefore cannot use it (nor containers or nested sub-agents); the lead still can.
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
    const toolCalls = n === 1
      ? [{ id: "b1", name: "rollback_workspace", input: {} }]
      : [{ id: `b${n}`, name: "task_complete", input: { summary: "done", files_written: [], verification_passed: true } }];
    return { content: "", toolCalls, stopReason: "STOP", modelUsed: "fake-model", promptTokens: 10, completionTokens: 5, rawParts: toolCalls.map((c) => ({ functionCall: { name: c.name, args: c.input } })) };
  },
}));
const { runAgentWithGemini } = await import("./gemini-loop.ts");
afterAll(() => {
  active = false;
});

test("a helper's rollback_workspace is refused and nobody's files are touched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "blocked-"));
  writeFileSync(join(dir, "other-helpers-file.tsx"), "export const x = 1;\n");
  n = 0;
  sent = [];
  active = true;
  try {
    await runAgentWithGemini({
      agentName: "aanya", model: "meta/muse-glimmer-30b", apiKey: "x", systemPrompt: "s", initialMessage: "build", sandboxDir: dir, maxIterations: 3, skipEvidenceGate: true,
      ...teamRunOverrides({ role: "helper", helperIndex: 0, ownFiles: [] }, dir, { taskFiles: [] }),
    });
    expect(sent[1]).toContain("rollback_workspace is not available");
    expect(existsSync(join(dir, "other-helpers-file.tsx"))).toBe(true);
  } finally {
    active = false;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("helpers and the shared step have rollback, containers and sub-agents blocked; the lead does not", () => {
  const helper = teamRunOverrides({ role: "helper", ownFiles: [] }, ".", { taskFiles: [] });
  const shared = teamRunOverrides({ role: "shared", avoidFiles: [] }, ".", { taskFiles: [] });
  const lead = teamRunOverrides({ role: "integrate" }, ".", { taskFiles: [] });
  for (const o of [helper, shared]) expect(o.blockedTools).toEqual(expect.arrayContaining(["rollback_workspace", "docker_compose", "spawn_subagent"]));
  expect(lead.blockedTools).toBeUndefined();
});
