import { test, expect, mock, afterAll } from "bun:test";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 2026-10-24 (Brewline test build, live review): the reality checker runs read-only (an evaluator never changes the app),
// but a sub-check it started did not inherit that rule. The sub-check wrote a script and ran it, and it overwrote the
// staff account's password in the app's database with a value it chose. A sub-check must run under the same limits as
// the agent that started it.
//
// Same fake-model pattern as builder-batching.integration.test.ts: mock.module is process-global, so the fake is used
// only while `active` is set, and the router captured before mocking serves everyone else.
const real = await import("@nexsidi/llm-client");
const realRoute = real.routeToolsWithFallback;
let active = false;
let script: { name: string; input: Record<string, unknown> }[][] = [];
let n = 0;

mock.module("@nexsidi/llm-client", () => ({
  ...real,
  routeToolsWithFallback: async (...args: Parameters<typeof real.routeToolsWithFallback>) => {
    if (!active) return realRoute(...args);
    n++;
    const toolCalls = (script.shift() ?? [{ name: "task_complete", input: { summary: "done", files_written: [], verification_passed: true } }])
      .map((c, i) => ({ id: `s${n}-${i}`, ...c }));
    return { content: "", toolCalls, stopReason: "STOP", modelUsed: "fake-model", promptTokens: 10, completionTokens: 5, rawParts: toolCalls.map((c) => ({ functionCall: { name: c.name, args: c.input } })) };
  },
}));

const { runAgentWithGemini } = await import("./gemini-loop.ts");

afterAll(() => {
  active = false;
});

test("a sub-check started by a read-only agent cannot write files or run commands", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sro-"));
  const done = { name: "task_complete", input: { summary: "done", files_written: [], verification_passed: true } };
  script = [
    [{ name: "spawn_subagent", input: { agentName: "Updater", subtask: "Change the staff password." } }],
    [
      { name: "write_file", input: { path: "update.js", content: "console.log('changed')" } },
      { name: "run_command", input: { command: "node -e \"require('fs').writeFileSync('ran.txt','x')\"" } },
    ],
    [done],
    [done],
  ];
  active = true;
  try {
    await runAgentWithGemini({
      agentName: "tilotma-reality-checker",
      model: "meta/muse-glimmer-30b",
      apiKey: "unused",
      systemPrompt: "Verify the claims. Never change the app.",
      initialMessage: "Verify.",
      sandboxDir: dir,
      maxIterations: 4,
      readOnly: true,
    });
  } finally {
    active = false;
  }
  try {
    expect(existsSync(join(dir, "update.js"))).toBe(false);
    expect(existsSync(join(dir, "ran.txt"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("both agent loops pass the read-only limits on to a sub-check", () => {
  for (const file of ["gemini-loop.ts", "loop.ts"]) {
    const src = require("node:fs").readFileSync(new URL(`./${file}`, import.meta.url), "utf-8") as string;
    const spawn = src.slice(src.indexOf('case "spawn_subagent": {'), src.indexOf('case "spawn_subagent": {') + 2500);
    expect({ file, ok: spawn.includes("readOnly: config.readOnly") && spawn.includes("readOnlyDirs: config.readOnlyDirs") && spawn.includes("writableFile: config.writableFile") }).toEqual({ file, ok: true });
  }
});
