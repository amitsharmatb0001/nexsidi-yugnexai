import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { isOverBudget, type SpendStore } from "./cost-budget.ts";

// 2026-10-23 (Brewline test build): the $10 cap was checked only when a step started. The review-and-fix step started at
// $8.31 and kept running rounds inside the same step: $11.02, then $13.22, and $13.61 before it was stopped by hand. A
// cap must stop spending when it is reached. Every agent loop now checks it before each model call, and the review and
// live loops check it before each round.

const store = (spent: number): SpendStore => ({
  async getTotals() { return { tokensIn: 0, tokensOut: 0, costUsd: spent }; },
  async addTotals() {},
});

test("over the cap is reported, under it is not, and a failed read never stops a build", async () => {
  process.env.COST_BUDGET_CAP_USD = "10";
  expect(await isOverBudget("p", store(9.99))).toBe(false);
  expect(await isOverBudget("p", store(10))).toBe(true);
  expect(await isOverBudget("p", store(13.61))).toBe(true);
  const broken: SpendStore = { async getTotals() { throw new Error("db down"); }, async addTotals() {} };
  expect(await isOverBudget("p", broken)).toBe(false);
  delete process.env.COST_BUDGET_CAP_USD;
});

for (const file of ["gemini-loop.ts", "qa-loop.ts", "loop.ts"]) {
  test(`${file} checks the cap before each model call`, () => {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf-8");
    expect(src).toContain("await isOverBudget(config.projectId)");
    expect(src).toContain("budget_exceeded:");
  });
}

test("the review and live loops check the cap before each round, and their steps raise the budget stop", () => {
  const qa = readFileSync(new URL("../../../pipeline/orchestrator/stages/stage5-qa-fix-loop.ts", import.meta.url), "utf-8");
  const live = readFileSync(new URL("../../../pipeline/orchestrator/stages/stage6-deployment.ts", import.meta.url), "utf-8");
  expect(qa).toContain("await isOverBudget(projectId)");
  expect(live).toContain("await isOverBudget(projectId)");
  const acts = readFileSync(new URL("../../../pipeline/activities/index.ts", import.meta.url), "utf-8");
  const qaAct = acts.slice(acts.indexOf("export async function runQAFixLoopActivity"), acts.indexOf("export async function runQAFixLoopActivity") + 1500);
  expect(qaAct).toContain('await assertWithinBudget(projectId, "qa-gan (after the rounds)")');
});
