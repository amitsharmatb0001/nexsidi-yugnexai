import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { stepBudgetNotice, WRAP_UP_STEPS } from "./step-budget.ts";

// 2026-09-29 (project a034f90ba50e): agents hit their step cap mid-work with
// nothing reported — the reality checker was still taking "recheck"
// screenshots at step 61 of 61 (no verdict, the whole review lost), and
// Aanya's finished design fix hit 40 of 40 while clicking through the app
// (success:false). No loop ever told an agent its budget was nearly spent.
test("warns when WRAP_UP_STEPS steps are left and again on the last step", () => {
  expect(stepBudgetNotice(61 - WRAP_UP_STEPS, 61)).toContain(`${WRAP_UP_STEPS} steps left`);
  expect(stepBudgetNotice(60, 61)).toContain("LAST step");
  expect(stepBudgetNotice(60, 61)).toContain("task_complete");
});

test("stays silent on every other step", () => {
  for (const i of [1, 10, 55, 57, 58, 59]) expect(stepBudgetNotice(i, 61)).toBeNull();
  expect(stepBudgetNotice(61, 61)).toBeNull();
});

test("a budget no bigger than the wrap-up window only gets the last-step warning", () => {
  expect(stepBudgetNotice(0, 5)).toBeNull();
  expect(stepBudgetNotice(4, 5)).toContain("LAST step");
});

test("every agent loop appends the step-budget notice after each step's tool results", () => {
  for (const file of ["loop.ts", "gemini-loop.ts", "claude-loop.ts"]) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf-8");
    expect(source).toContain("stepBudgetNotice(iterations, stepBudget.max)");
  }
});

// 2026-10-02 (Ledgerly benchmark run 2): a warning only 5 steps from the
// end came too late — the frontend builder spent those steps deleting
// scratch files. Agents now also hear at 80% of the budget.
test("warns once when 80% of the steps are used", () => {
  expect(stepBudgetNotice(72, 90)).toContain("80%");
  expect(stepBudgetNotice(71, 90)).toBeNull();
  expect(stepBudgetNotice(73, 90)).toBeNull();
});
