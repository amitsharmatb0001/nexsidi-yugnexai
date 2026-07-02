// Tests runAgentEscalated's ORCHESTRATION logic only, using injected stub
// versions of runAgent/runAgentWithClaude — same dependency-injection pattern
// as pipeline/orchestrator/run.ts's runPipelineWithStages and
// stage6-deployment.ts's injectable `deps` (default deps wrap the real
// functions; tests always pass their own stubs). No real LLM calls happen in
// this file. runAgentWithClaude's own tool-loop mechanics are exercised by
// the mandatory stress-test runs, not unit tests, mirroring how loop.ts's
// runAgent() itself has no direct unit test of its live-call behavior.
import { test, expect } from "bun:test";
import { runAgentEscalated, type AgentEscalationDeps } from "./claude-loop.ts";
import type { AgentRunConfig, AgentRunResult } from "./loop.ts";

const BASE_CONFIG: AgentRunConfig = {
  agentName: "test-agent",
  model: "moonshotai/kimi-k2.6",
  apiKey: "nim-key",
  systemPrompt: "system",
  initialMessage: "do the thing",
  sandboxDir: "/tmp/sandbox",
};

function nimSuccess(): Promise<AgentRunResult> {
  return Promise.resolve({
    success: true,
    summary: "done via NIM",
    filesWritten: ["a.ts"],
    iterations: 3,
    errors: [],
  });
}

function nimFailure(): Promise<AgentRunResult> {
  return Promise.resolve({
    success: false,
    summary: "NIM gave up",
    filesWritten: [],
    iterations: 40,
    errors: ["Max iterations exceeded"],
  });
}

function claudeSuccess(): Promise<AgentRunResult> {
  return Promise.resolve({
    success: true,
    summary: "done via Claude",
    filesWritten: ["a.ts", "b.ts"],
    iterations: 5,
    errors: [],
  });
}

function claudeFailure(): Promise<AgentRunResult> {
  return Promise.resolve({
    success: false,
    summary: "Claude also gave up",
    filesWritten: [],
    iterations: 40,
    errors: ["Max iterations exceeded"],
  });
}

test("NIM success -> no escalation, Claude is never called", async () => {
  let claudeCalled = false;
  const deps: AgentEscalationDeps = {
    runNim: nimSuccess,
    runClaude: async () => {
      claudeCalled = true;
      return claudeSuccess();
    },
  };

  const result = await runAgentEscalated(BASE_CONFIG, deps);

  expect(claudeCalled).toBe(false);
  expect(result.escalated).toBe(false);
  expect(result.success).toBe(true);
  expect(result.summary).toBe("done via NIM");
});

test("NIM failure -> Claude is called, escalated: true, Claude's success is returned", async () => {
  let claudeCalled = false;
  const deps: AgentEscalationDeps = {
    runNim: nimFailure,
    runClaude: async () => {
      claudeCalled = true;
      return claudeSuccess();
    },
  };

  const result = await runAgentEscalated(BASE_CONFIG, deps);

  expect(claudeCalled).toBe(true);
  expect(result.escalated).toBe(true);
  expect(result.success).toBe(true);
  expect(result.summary).toBe("done via Claude");
});

test("both fail -> returns Claude's (more informative) result, escalated: true", async () => {
  const deps: AgentEscalationDeps = {
    runNim: nimFailure,
    runClaude: claudeFailure,
  };

  const result = await runAgentEscalated(BASE_CONFIG, deps);

  expect(result.escalated).toBe(true);
  expect(result.success).toBe(false);
  expect(result.summary).toBe("Claude also gave up");
  // Not the NIM failure summary — Claude's attempt is authoritative on double failure.
  expect(result.summary).not.toBe("NIM gave up");
});

test("runAgentEscalated passes the SAME config through to both the NIM and Claude paths", async () => {
  const seenConfigs: AgentRunConfig[] = [];
  const deps: AgentEscalationDeps = {
    runNim: async (cfg) => {
      seenConfigs.push(cfg);
      return nimFailure();
    },
    runClaude: async (cfg) => {
      seenConfigs.push(cfg);
      return claudeSuccess();
    },
  };

  await runAgentEscalated(BASE_CONFIG, deps);

  expect(seenConfigs).toHaveLength(2);
  expect(seenConfigs[0]).toBe(BASE_CONFIG);
  expect(seenConfigs[1]).toBe(BASE_CONFIG);
});
