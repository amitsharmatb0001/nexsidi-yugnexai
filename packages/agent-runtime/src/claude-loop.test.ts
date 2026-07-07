// Tests runAgentEscalated's ORCHESTRATION logic only, using injected stub
// versions of runAgent/runAgentWithClaude — same dependency-injection pattern
// as pipeline/orchestrator/run.ts's runPipelineWithStages and
// stage6-deployment.ts's injectable `deps` (default deps wrap the real
// functions; tests always pass their own stubs). No real LLM calls happen in
// this file. runAgentWithClaude's own tool-loop mechanics are exercised by
// the mandatory stress-test runs, not unit tests, mirroring how loop.ts's
// runAgent() itself has no direct unit test of its live-call behavior.
import { test, expect } from "bun:test";
import { runAgentEscalated, buildEscalationMessage, isUnrecoverableClaudeError, resolveEscalationRunner, runAgentWithClaude, type AgentEscalationDeps } from "./claude-loop.ts";
import { runAgentWithGemini } from "./gemini-loop.ts";
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

function nimFailureWithProgress(): Promise<AgentRunResult> {
  return Promise.resolve({
    success: false,
    summary: "NIM ran out of iterations mid-task",
    filesWritten: ["src/index.ts", "src/routes/tasks.ts"],
    iterations: 40,
    errors: ["npm install failed: ETIMEDOUT", "tsc: 3 errors in src/routes/tasks.ts"],
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

test("runAgentEscalated passes the ORIGINAL config unchanged to the NIM path", async () => {
  const seenConfigs: AgentRunConfig[] = [];
  const deps: AgentEscalationDeps = {
    runNim: async (cfg) => {
      seenConfigs.push(cfg);
      return nimFailure();
    },
    runClaude: async () => claudeSuccess(),
  };

  await runAgentEscalated(BASE_CONFIG, deps);

  expect(seenConfigs).toHaveLength(1);
  expect(seenConfigs[0]).toBe(BASE_CONFIG); // exact same reference — NIM path is untouched
});

// L6 (full-system audit): runAgentWithClaude previously started cold with
// zero knowledge of what the failed NIM attempt tried, wrote, or errored on
// — wasting whatever real progress NIM made before hitting MAX_ITERATIONS.
// The Claude config must now carry that context forward in initialMessage,
// while every OTHER field (systemPrompt, sandboxDir, model, ...) stays
// identical to what the NIM path used.

test("runAgentEscalated hands NIM's filesWritten/errors to Claude via an enriched initialMessage, leaving every other config field untouched", async () => {
  const seenConfigs: AgentRunConfig[] = [];
  const deps: AgentEscalationDeps = {
    runNim: nimFailureWithProgress,
    runClaude: async (cfg) => {
      seenConfigs.push(cfg);
      return claudeSuccess();
    },
  };

  await runAgentEscalated(BASE_CONFIG, deps);

  expect(seenConfigs).toHaveLength(1);
  const claudeConfig = seenConfigs[0]!;
  expect(claudeConfig).not.toBe(BASE_CONFIG); // rebuilt, not the same reference
  expect(claudeConfig.systemPrompt).toBe(BASE_CONFIG.systemPrompt);
  expect(claudeConfig.sandboxDir).toBe(BASE_CONFIG.sandboxDir);
  expect(claudeConfig.model).toBe(BASE_CONFIG.model);
  expect(claudeConfig.initialMessage).toContain(BASE_CONFIG.initialMessage);
  expect(claudeConfig.initialMessage).toContain("src/index.ts");
  expect(claudeConfig.initialMessage).toContain("src/routes/tasks.ts");
  expect(claudeConfig.initialMessage).toContain("npm install failed: ETIMEDOUT");
});

test("runAgentEscalated leaves initialMessage unchanged when NIM made zero progress (no files, no errors)", async () => {
  const seenConfigs: AgentRunConfig[] = [];
  const deps: AgentEscalationDeps = {
    // NIM result with no files written and no errors recorded — e.g. an
    // immediate empty-response bail before anything was attempted.
    runNim: async () => ({ success: false, summary: "empty response", filesWritten: [], iterations: 1, errors: [] }),
    runClaude: async (cfg) => {
      seenConfigs.push(cfg);
      return claudeSuccess();
    },
  };

  await runAgentEscalated(BASE_CONFIG, deps);

  expect(seenConfigs[0]!.initialMessage).toBe(BASE_CONFIG.initialMessage);
});

test("buildEscalationMessage appends files-written and errors sections when either is present", () => {
  const msg = buildEscalationMessage("build a task manager", {
    success: false,
    summary: "gave up",
    filesWritten: ["a.ts"],
    iterations: 40,
    errors: ["boom"],
  });
  expect(msg).toContain("build a task manager");
  expect(msg).toContain("a.ts");
  expect(msg).toContain("boom");
});

test("buildEscalationMessage returns the original message unchanged when there's nothing to hand off", () => {
  const msg = buildEscalationMessage("build a task manager", {
    success: false,
    summary: "gave up immediately",
    filesWritten: [],
    iterations: 1,
    errors: [],
  });
  expect(msg).toBe("build a task manager");
});

// Found live 2026-07-06 testing Claude-via-Vertex-AI (packages/llm-client/src/
// claude.ts's createClaudeClient): a fresh Vertex AI project's default quota
// for a foundation model is 0/near-zero until Google approves an explicit
// quota-increase request (can take hours) — every retry within the same run
// hits the identical wall. runAgentWithClaude's catch block previously
// treated every error identically (log, sleep 5s, retry, up to
// MAX_ITERATIONS=40 times) — for this error class that's ~200s of guaranteed
// waste before the run fails anyway. Same category as auth/permission
// failures: retrying THIS run will never succeed.
test("isUnrecoverableClaudeError recognizes a Vertex AI quota-exhaustion error", () => {
  const err = new Error(
    '[Claude claude-sonnet-5] rate limited: 429 {"error":{"code":429,"message":"Quota exceeded for ' +
    'aiplatform.googleapis.com/online_prediction_input_tokens_per_minute_per_base_model with base model: ' +
    'anthropic-claude-sonnet-5. Please submit a quota increase request.","status":"RESOURCE_EXHAUSTED"}}',
  );
  expect(isUnrecoverableClaudeError(err)).toBe(true);
});

test("isUnrecoverableClaudeError recognizes an authentication failure", () => {
  expect(isUnrecoverableClaudeError(new Error("[Claude claude-sonnet-5] authentication failed: invalid x-api-key"))).toBe(true);
});

test("isUnrecoverableClaudeError recognizes a permission-denied failure", () => {
  expect(isUnrecoverableClaudeError(new Error("[Claude claude-sonnet-5] permission denied: model not enabled"))).toBe(true);
});

test("isUnrecoverableClaudeError does NOT flag a generic transient error (network blip, ordinary rate limit) — those are worth retrying", () => {
  expect(isUnrecoverableClaudeError(new Error("[Claude claude-sonnet-5] connection error: fetch failed"))).toBe(false);
  expect(isUnrecoverableClaudeError(new Error("AbortError: The operation was aborted."))).toBe(false);
});

// 2026-07-06: Claude on Vertex is blocked project-wide by Google's
// partner-model sales gating (see gemini.ts's header comment for the live
// evidence) — Gemini has no such gating and was confirmed working live.
// ESCALATION_PROVIDER lets the second-tier model be swapped per environment
// without touching runAgentEscalated's own orchestration logic.
test("resolveEscalationRunner defaults to runAgentWithClaude when ESCALATION_PROVIDER is unset", () => {
  delete process.env.ESCALATION_PROVIDER;
  expect(resolveEscalationRunner()).toBe(runAgentWithClaude);
});

test("resolveEscalationRunner returns runAgentWithGemini when ESCALATION_PROVIDER=gemini", () => {
  process.env.ESCALATION_PROVIDER = "gemini";
  expect(resolveEscalationRunner()).toBe(runAgentWithGemini);
  delete process.env.ESCALATION_PROVIDER;
});

test("resolveEscalationRunner falls back to runAgentWithClaude for any other value", () => {
  process.env.ESCALATION_PROVIDER = "anthropic";
  expect(resolveEscalationRunner()).toBe(runAgentWithClaude);
  delete process.env.ESCALATION_PROVIDER;
});

// Phase 5 Task 4: nexsidi-token-budget requires every escalation logged with
// cause. runAgentEscalated must surface nimResult.escalationReason in its
// log line, defaulting to "cannot_finish" when the NIM result predates this
// field (or exits via a path that doesn't set it).
test("runAgentEscalated logs the NIM result's escalationReason (three_strikes)", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);
  try {
    const deps: AgentEscalationDeps = {
      runNim: async () => ({ success: false, summary: "s", filesWritten: [], iterations: 5, errors: [], escalationReason: "three_strikes" }),
      runClaude: async () => claudeSuccess(),
    };
    await runAgentEscalated(BASE_CONFIG, deps);
  } finally {
    console.log = originalLog;
  }
  expect(logs.some((l) => l.includes("reason: three_strikes"))).toBe(true);
});

test("runAgentEscalated defaults the logged reason to cannot_finish when escalationReason is absent", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);
  try {
    const deps: AgentEscalationDeps = { runNim: nimFailure, runClaude: async () => claudeSuccess() };
    await runAgentEscalated(BASE_CONFIG, deps);
  } finally {
    console.log = originalLog;
  }
  expect(logs.some((l) => l.includes("reason: cannot_finish"))).toBe(true);
});
