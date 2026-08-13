// Task 1 of docs/nexsidi/plans/2026-08-11-cost-control.md — a hard
// per-project token/$ budget that halts BEFORE overspend, not after. Direct
// response to a real incident: a project burned $29K of GCP/Gemini credits
// in a week because nothing in the pipeline ever checked a running dollar
// total against a ceiling.
//
// recordSpend/checkBudget are DB-backed in production (packages/db/schema.ts's
// token_spend table), but this file never needs a live DATABASE_URL to run —
// same discipline as packages/db/src/instincts.test.ts, which only exercises
// the pure helper functions and never the DB-touching ones directly. Here,
// recordSpend/checkBudget themselves ARE exercised (the whole point of this
// task is testing the accumulate-then-halt behavior), via an injectable
// SpendStore fake in place of the real Drizzle-backed store — the same seam
// instincts.ts's dynamic `await import("./client.ts")` creates, just made
// explicit as a parameter instead of an internal import swap.
import { test, expect } from "bun:test";
import {
  computeCostUsd,
  rateForModel,
  resolveBudgetCapUsd,
  evaluateBudget,
  recordSpend,
  checkBudget,
  type SpendStore,
  type SpendTotals,
} from "./cost-budget.ts";

// ── Pure math — no store, no I/O ────────────────────────────────────────────

test("computeCostUsd prices known models at their documented $/1M rate", () => {
  // gemini-3.5-flash: $0.30 in / $2.50 out per 1M (see PRICING table comment)
  const cost = computeCostUsd(1_000_000, 1_000_000, "gemini-3.5-flash");
  expect(cost).toBeCloseTo(0.30 + 2.50, 6);
});

test("computeCostUsd scales linearly with token count", () => {
  const cost = computeCostUsd(500_000, 10_000, "gemini-3.5-flash");
  expect(cost).toBeCloseTo(500_000 / 1_000_000 * 0.30 + 10_000 / 1_000_000 * 2.50, 6);
});

test("rateForModel returns a real rate for every model this repo actually calls", () => {
  // gemini.ts's resolveGeminiModel/GEMINI_ESCALATION_MODEL + the Claude
  // models this task's brief named as an evaluated backend.
  for (const model of [
    "gemini-3.1-pro-preview",
    "gemini-3.5-flash",
    "gemini-3.6-flash",
    "gemini-2.5-flash-lite",
    "claude-sonnet-5",
    "claude-opus-4-8",
    "claude-haiku-4-5",
  ]) {
    const rate = rateForModel(model);
    expect(rate.inputPerMillion).toBeGreaterThan(0);
    expect(rate.outputPerMillion).toBeGreaterThan(0);
  }
});

test("rateForModel falls back to a conservative rate for an unpriced model name", () => {
  // Must not silently price an unknown model at $0 — that would let spend
  // go unmeasured (and therefore unbudgeted) the instant a new model is
  // added to a router pool before this table is updated.
  const rate = rateForModel("some-brand-new-model-not-in-the-table");
  expect(rate.inputPerMillion).toBeGreaterThan(0);
  expect(rate.outputPerMillion).toBeGreaterThan(0);
});

test("resolveBudgetCapUsd uses the default when COST_BUDGET_CAP_USD is unset", () => {
  const prior = process.env.COST_BUDGET_CAP_USD;
  delete process.env.COST_BUDGET_CAP_USD;
  try {
    expect(resolveBudgetCapUsd()).toBe(50);
  } finally {
    if (prior !== undefined) process.env.COST_BUDGET_CAP_USD = prior;
  }
});

test("resolveBudgetCapUsd honors a valid COST_BUDGET_CAP_USD override", () => {
  const prior = process.env.COST_BUDGET_CAP_USD;
  process.env.COST_BUDGET_CAP_USD = "12.5";
  try {
    expect(resolveBudgetCapUsd()).toBe(12.5);
  } finally {
    if (prior === undefined) delete process.env.COST_BUDGET_CAP_USD;
    else process.env.COST_BUDGET_CAP_USD = prior;
  }
});

test("resolveBudgetCapUsd falls back to the default on a garbage override instead of breaking", () => {
  const prior = process.env.COST_BUDGET_CAP_USD;
  process.env.COST_BUDGET_CAP_USD = "not-a-number";
  try {
    expect(resolveBudgetCapUsd()).toBe(50);
  } finally {
    if (prior === undefined) delete process.env.COST_BUDGET_CAP_USD;
    else process.env.COST_BUDGET_CAP_USD = prior;
  }
});

test("evaluateBudget is within budget strictly below the cap", () => {
  expect(evaluateBudget(49.99, 50).withinBudget).toBe(true);
});

test("evaluateBudget halts at or above the cap", () => {
  expect(evaluateBudget(50, 50).withinBudget).toBe(false);
  expect(evaluateBudget(50.01, 50).withinBudget).toBe(false);
});

// ── recordSpend/checkBudget against an injectable in-memory store ──────────
// Mirrors the exact scenario from the plan's Task 1 spec: record a spend
// large enough to cross a low cap, then confirm checkBudget reports halted.

class FakeSpendStore implements SpendStore {
  private rows = new Map<string, SpendTotals>();

  async getTotals(projectId: string): Promise<SpendTotals | null> {
    return this.rows.get(projectId) ?? null;
  }

  async addTotals(projectId: string, deltaTokensIn: number, deltaTokensOut: number, deltaCostUsd: number): Promise<void> {
    const existing = this.rows.get(projectId) ?? { tokensIn: 0, tokensOut: 0, costUsd: 0 };
    this.rows.set(projectId, {
      tokensIn: existing.tokensIn + deltaTokensIn,
      tokensOut: existing.tokensOut + deltaTokensOut,
      costUsd: existing.costUsd + deltaCostUsd,
    });
  }
}

test("checkBudget halts once cumulative spend crosses the per-project cap", async () => {
  const prior = process.env.COST_BUDGET_CAP_USD;
  // Cap set low and explicit so the test doesn't depend on the module's
  // internal default — 500_000 in + 10_000 out of gemini-3.5-flash costs
  // 500_000/1e6*0.30 + 10_000/1e6*2.50 = 0.15 + 0.025 = $0.175, comfortably
  // over a $0.10 cap.
  process.env.COST_BUDGET_CAP_USD = "0.10";
  try {
    const store = new FakeSpendStore();
    await recordSpend("proj1", 500_000, 10_000, "gemini-3.5-flash", store);
    const result = await checkBudget("proj1", store);
    expect(result.withinBudget).toBe(false);
    expect(result.spentUsd).toBeCloseTo(0.175, 6);
    expect(result.capUsd).toBe(0.10);
  } finally {
    if (prior === undefined) delete process.env.COST_BUDGET_CAP_USD;
    else process.env.COST_BUDGET_CAP_USD = prior;
  }
});

test("checkBudget stays within budget for a project with no recorded spend yet", async () => {
  const store = new FakeSpendStore();
  const result = await checkBudget("brand-new-project", store);
  expect(result.withinBudget).toBe(true);
  expect(result.spentUsd).toBe(0);
});

test("recordSpend accumulates across multiple calls instead of overwriting", async () => {
  const store = new FakeSpendStore();
  await recordSpend("proj2", 100_000, 5_000, "gemini-3.5-flash", store);
  await recordSpend("proj2", 100_000, 5_000, "gemini-3.5-flash", store);
  const totals = await store.getTotals("proj2");
  expect(totals?.tokensIn).toBe(200_000);
  expect(totals?.tokensOut).toBe(10_000);
});

test("recordSpend keeps two projects' totals independent", async () => {
  const store = new FakeSpendStore();
  await recordSpend("proj-a", 1_000_000, 0, "gemini-3.5-flash", store);
  await recordSpend("proj-b", 10, 10, "gemini-3.5-flash", store);
  const a = await checkBudget("proj-a", store);
  const b = await checkBudget("proj-b", store);
  expect(a.spentUsd).toBeGreaterThan(b.spentUsd);
});
