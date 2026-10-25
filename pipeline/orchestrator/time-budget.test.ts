import { test, expect, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { qaBudgetMs, liveBudgetMs } from "./time-budget.ts";
import { runQAFixLoopWithDeps, type QAFixDeps } from "./stages/stage5-qa-fix-loop.ts";

// 2026-10-25 (brewline3, Amit: "a clean build in 1 hour, not 4"): the plan gave no stage any time limit; the review loop ran for two
// hours and the live stage for 45 minutes, a round at a time. Each repeating stage now has a time budget. When it is used up the loop
// stops starting new rounds and holds the build for a human with the open findings, instead of burning more time and tokens.
const prevQa = process.env.QA_TIME_BUDGET_MIN;
const prevLive = process.env.LIVE_TIME_BUDGET_MIN;
afterEach(() => {
  if (prevQa === undefined) delete process.env.QA_TIME_BUDGET_MIN; else process.env.QA_TIME_BUDGET_MIN = prevQa;
  if (prevLive === undefined) delete process.env.LIVE_TIME_BUDGET_MIN; else process.env.LIVE_TIME_BUDGET_MIN = prevLive;
});

test("the budgets have measured defaults and can be set or switched off from the environment", () => {
  delete process.env.QA_TIME_BUDGET_MIN;
  delete process.env.LIVE_TIME_BUDGET_MIN;
  expect(qaBudgetMs()).toBe(40 * 60_000);
  expect(liveBudgetMs()).toBe(30 * 60_000);
  process.env.QA_TIME_BUDGET_MIN = "15";
  expect(qaBudgetMs()).toBe(15 * 60_000);
  process.env.QA_TIME_BUDGET_MIN = "0";
  expect(qaBudgetMs()).toBe(Infinity);
  process.env.QA_TIME_BUDGET_MIN = "not a number";
  expect(qaBudgetMs()).toBe(40 * 60_000);
});

const PLAN = { projectId: "tb-proj", appName: "T", appDescription: "", designBrief: {}, sharedTypes: "", apiContract: { baseUrl: "", endpoints: [] }, dbSchema: { tables: [] }, shubhamTasks: [], aanyaTasks: [], pranavTasks: [], independenceVerified: true, buildPlanHash: "x" } as never;
const STAGE4 = { backendOutputDir: "b", frontendOutputDir: "f", filesWritten: [] };
const fail = { pass: false, faultAgent: "shubham", findings: [{ file: "backend/a.ts", issue: "issue a" }, { file: "backend/b.ts", issue: "issue b" }] };

test("the review loop stops starting rounds once its time is used, and holds the build with the open findings", async () => {
  process.env.QA_TIME_BUDGET_MIN = "0.001"; // 60 ms
  let reviews = 0;
  let fixes = 0;
  const deps: QAFixDeps = {
    runStage5: async () => { reviews++; await new Promise((r) => setTimeout(r, 120)); return fail as never; },
    fixShubham: async () => { fixes++; return { success: true, filesWritten: ["src/a.ts"] }; },
    fixAanya: async () => ({ success: true }),
  };
  const out = await runQAFixLoopWithDeps("tb-proj", PLAN, STAGE4 as never, deps);
  expect(out.pass).toBe(false);
  expect(out.hold?.reason).toContain("time budget");
  expect(out.hold?.evidence.join("\n")).toContain("backend/a.ts");
  expect(reviews).toBe(1); // the first review was already over budget: no second round
  expect(fixes).toBe(0);
});

test("with no budget set the loop behaves as before", async () => {
  process.env.QA_TIME_BUDGET_MIN = "0";
  let reviews = 0;
  const deps: QAFixDeps = {
    runStage5: async () => { reviews++; return reviews === 1 ? (fail as never) : ({ pass: true, findings: [] } as never); },
    fixShubham: async () => ({ success: true, filesWritten: ["src/a.ts"] }),
    fixAanya: async () => ({ success: true }),
  };
  const out = await runQAFixLoopWithDeps("tb-proj", PLAN, STAGE4 as never, deps);
  expect(out.pass).toBe(true);
});

test("the live stage stops starting fix rounds when its time is used", () => {
  const src = readFileSync(new URL("./stages/stage6-deployment.ts", import.meta.url), "utf-8");
  expect(src).toContain("liveBudgetMs()");
  expect(src).toContain("time budget");
});
