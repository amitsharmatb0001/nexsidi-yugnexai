import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { buildToolList } from "./loop.ts";

// 2026-10-29 (team plan, stage 2): builders get ask_question; every loop runs it; the answers reach every builder's task.
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf-8");

test("ask_question is offered only to runs that enable it", () => {
  const base = { agentName: "shubham", model: "x", apiKey: "", systemPrompt: "", initialMessage: "", sandboxDir: "." } as never;
  const names = (cfg: object) => buildToolList({ ...(base as object), ...cfg } as never).map((t) => t.function.name);
  expect(names({})).not.toContain("ask_question");
  expect(names({ enableAsk: true })).toContain("ask_question");
});

test("all three agent loops run ask_question for the run's project and agent", () => {
  for (const loop of ["./loop.ts", "./gemini-loop.ts", "./claude-loop.ts"]) {
    expect(src(loop)).toContain('case "ask_question"');
    expect(src(loop)).toContain("execAskQuestion(config.projectId, config.agentName");
  }
});

test("the three builders may ask, in their build runs and their fix runs", () => {
  expect((src("../../../agents/generators/shubham/src/index.ts").match(/enableAsk: true/g) ?? []).length).toBe(2);
  expect((src("../../../agents/generators/aanya/src/index.ts").match(/enableAsk: true/g) ?? []).length).toBe(2);
  expect((src("../../../agents/generators/pranav/src/index.ts").match(/enableAsk: true/g) ?? []).length).toBe(1);
});

test("the answers given during the build are in every builder's task", () => {
  expect(src("../../../agents/generators/shubham/src/index.ts")).toContain("answersBlock(plan.projectId)");
  expect(src("../../../agents/generators/aanya/src/index.ts")).toContain("answersBlock(plan.projectId)");
  expect(src("../../../agents/generators/pranav/src/index.ts")).toContain("answersBlock(plan.projectId)");
});
