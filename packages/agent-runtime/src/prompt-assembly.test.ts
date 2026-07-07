import { test, expect } from "bun:test";
import { assembleSystemPrompt } from "./prompt-assembly.ts";

// Phase 5 Task 6 (final-bundle/phase5-harness-enforcement-plan.md): skills
// injected into every agent's system prompt at runtime. Fixed layering
// order: core-reasoning doctrine -> agent's own doctrine (if any) -> agent
// basePrompt -> task context. Budget-aware: trims task context first,
// then the agent's own doctrine — NEVER core-reasoning or the base prompt
// (nexsidi-token-budget rule: never trim the foundational discipline layer
// or the locked task instructions). Doctrine files live in
// packages/agent-runtime/skills/ (checked-in, synced by Task 8's script).

test("layering order: core-reasoning, then agent doctrine, then base prompt, then task context", () => {
  const result = assembleSystemPrompt({ agentName: "riya", basePrompt: "You are Riya.", taskContext: "Deploy the app." });
  const coreIdx = result.indexOf("NexSidi Core Reasoning");
  const doctrineIdx = result.indexOf("Riya Doctrine");
  const baseIdx = result.indexOf("You are Riya.");
  const taskIdx = result.indexOf("Deploy the app.");
  expect(coreIdx).toBeGreaterThanOrEqual(0);
  expect(doctrineIdx).toBeGreaterThan(coreIdx);
  expect(baseIdx).toBeGreaterThan(doctrineIdx);
  expect(taskIdx).toBeGreaterThan(baseIdx);
});

test("an agent with no doctrine file gets core-reasoning + base only — no throw", () => {
  const result = assembleSystemPrompt({ agentName: "shubham", basePrompt: "You are Shubham." });
  expect(result).toContain("NexSidi Core Reasoning");
  expect(result).toContain("You are Shubham.");
});

test("core-reasoning is always present even with no agentName match", () => {
  const result = assembleSystemPrompt({ agentName: "some-unknown-agent", basePrompt: "base" });
  expect(result).toContain("NexSidi Core Reasoning");
});

test("with no contextBudgetTokens, nothing is trimmed — full task context survives", () => {
  const longTask = "x".repeat(50_000);
  const result = assembleSystemPrompt({ agentName: "shubham", basePrompt: "base", taskContext: longTask });
  expect(result).toContain(longTask);
});

test("over budget: task context is trimmed first, base prompt and core-reasoning survive intact", () => {
  const result = assembleSystemPrompt({
    agentName: "shubham",
    basePrompt: "PROTECTED BASE PROMPT",
    taskContext: "x".repeat(10_000),
    contextBudgetTokens: 200, // ~800 chars — core-reasoning alone already exceeds this
  });
  expect(result).toContain("PROTECTED BASE PROMPT");
  expect(result).toContain("NexSidi Core Reasoning");
  // Task context should be trimmed down, not present at full length
  expect(result.length).toBeLessThan(10_000);
});

test("over budget with doctrine present: doctrine is trimmed AFTER task context is already gone", () => {
  const resultWithRoom = assembleSystemPrompt({
    agentName: "riya",
    basePrompt: "PROTECTED BASE",
    taskContext: "short task",
    contextBudgetTokens: 100_000, // plenty of room — nothing trimmed
  });
  expect(resultWithRoom).toContain("Riya Doctrine");
  expect(resultWithRoom).toContain("short task");

  // Budget just above core-reasoning + base (leaves a little room, not
  // enough for the full 5000-char task context) — task context should be
  // trimmed down from its full length, base prompt still intact.
  const resultModeratelyTight = assembleSystemPrompt({
    agentName: "riya",
    basePrompt: "PROTECTED BASE",
    taskContext: "x".repeat(5000),
    contextBudgetTokens: 2000,
  });
  expect(resultModeratelyTight).toContain("PROTECTED BASE");
  expect(resultModeratelyTight).not.toContain("x".repeat(5000));

  // Budget below core-reasoning + base alone — doctrine is fully trimmed
  // away, but the protected base prompt and core-reasoning still survive.
  const resultExtremelyTight = assembleSystemPrompt({
    agentName: "riya",
    basePrompt: "PROTECTED BASE",
    taskContext: "x".repeat(5000),
    contextBudgetTokens: 10,
  });
  expect(resultExtremelyTight).toContain("PROTECTED BASE");
  expect(resultExtremelyTight).toContain("NexSidi Core Reasoning");
  expect(resultExtremelyTight).not.toContain("Riya Doctrine");
});

test("basePrompt is never trimmed even under an extremely tight budget", () => {
  const base = "y".repeat(2000);
  const result = assembleSystemPrompt({ agentName: "shubham", basePrompt: base, taskContext: "z".repeat(5000), contextBudgetTokens: 10 });
  expect(result).toContain(base);
});
