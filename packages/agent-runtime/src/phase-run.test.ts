import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { StepBudget, isProgressStep } from "./step-budget.ts";
import { conversationKeyFor } from "./loop.ts";

// 2026-10-02 (Part C.3, approved by Amit): builders work one phase at a time
// in a fresh, focused conversation, and their steps are not a fixed number —
// an agent still making progress gets more; one going in circles does not.

test("a phase gets its own saved conversation while the agent keeps its name, rules and skills", () => {
  expect(conversationKeyFor({ agentName: "aanya" })).toBe("aanya");
  expect(conversationKeyFor({ agentName: "aanya", conversationKey: "aanya-phase-2" })).toBe("aanya-phase-2");
  for (const file of ["loop.ts", "gemini-loop.ts", "claude-loop.ts"]) {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf-8");
    expect({ file, oldKey: src.includes("eq(agentConversations.agentName, config.agentName)") }).toEqual({ file, oldKey: false });
    expect({ file, newKey: src.includes("conversationKeyFor(config)") }).toEqual({ file, newKey: true });
  }
});

test("without extension, a run stops at its budget as before", () => {
  const b = new StepBudget(20, false);
  b.noteProgress(19);
  expect(b.canContinue(19)).toBe(true);
  expect(b.canContinue(20)).toBe(false);
});

test("an agent still making progress gets more steps, again and again — no fixed ceiling", () => {
  const b = new StepBudget(20, true);
  let i = 0;
  for (; i < 200; i++) {
    if (!b.canContinue(i)) break;
    b.noteProgress(i); // writes a file every step
  }
  expect(i).toBe(200);
  expect(b.max).toBeGreaterThan(20);
});

test("an agent that stopped making progress is not extended", () => {
  const b = new StepBudget(40, true);
  b.noteProgress(5); // early progress only
  expect(b.canContinue(40)).toBe(false);
});

test("writing files and passing a required check count as progress; reading and failing do not", () => {
  const req = ["npx tsc --noEmit"];
  expect(isProgressStep("write_file", { status: "success" }, {}, req)).toBe(true);
  expect(isProgressStep("edit_file", { status: "success" }, {}, req)).toBe(true);
  expect(isProgressStep("run_command", { status: "success" }, { command: "npx tsc --noEmit" }, req)).toBe(true);
  expect(isProgressStep("run_command", { status: "success" }, { command: "node -e \"1\"" }, req)).toBe(false);
  expect(isProgressStep("write_file", { status: "error" }, {}, req)).toBe(false);
  expect(isProgressStep("read_file", { status: "success" }, {}, req)).toBe(false);
});

test("every agent loop runs on the step budget and records progress", () => {
  for (const file of ["loop.ts", "gemini-loop.ts", "claude-loop.ts"]) {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf-8");
    expect({ file, budget: src.includes("stepBudget.canContinue(iterations)") }).toEqual({ file, budget: true });
    expect({ file, progress: src.includes("stepBudget.noteProgress(") }).toEqual({ file, progress: true });
  }
});
