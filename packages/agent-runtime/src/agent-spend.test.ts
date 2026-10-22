import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { recordSpend, type SpendStore } from "./cost-budget.ts";

// 2026-10-22: token_spend keeps one total per project, so the Trailhead rerun's $36.94 had to be split by agent from the
// worker logs (three reviewers 46%, frontend builder 24%). Each model call now also adds to its agent's row in agent_spend.

function fakeStore() {
  const totals: Array<[string, number]> = [];
  const agents: Array<{ projectId: string; agent: string; model: string; cost: number; cachedIn: number }> = [];
  const store: SpendStore = {
    async getTotals() { return null; },
    async addTotals(projectId, _i, _o, cost) { totals.push([projectId, cost]); },
    async addAgentTotals(projectId, agent, model, _i, _o, cachedIn, cost) { agents.push({ projectId, agent, model, cost, cachedIn }); },
  };
  return { store, totals, agents };
}

test("a call with an agent adds to both the project total and that agent's row, with the same cost", async () => {
  const s = fakeStore();
  await recordSpend("p1", 10_000, 500, "gemini-3.8-flash", s.store, 4_000, "navya");
  expect(s.totals).toHaveLength(1);
  expect(s.agents).toEqual([{ projectId: "p1", agent: "navya", model: "gemini-3.8-flash", cost: s.totals[0]![1], cachedIn: 4_000 }]);
});

test("a call without an agent, or a store without agent rows, still records the project total", async () => {
  const s = fakeStore();
  await recordSpend("p1", 100, 10, "gemini-3.8-flash", s.store);
  expect(s.totals).toHaveLength(1);
  expect(s.agents).toHaveLength(0);
  const plain: SpendStore = { async getTotals() { return null; }, async addTotals() {} };
  await expect(recordSpend("p1", 100, 10, "gemini-3.8-flash", plain, 0, "navya")).resolves.toBeUndefined();
});

test("a failing agent row never loses the project total", async () => {
  const totals: number[] = [];
  const store: SpendStore = {
    async getTotals() { return null; },
    async addTotals(_p, _i, _o, c) { totals.push(c); },
    async addAgentTotals() { throw new Error("db down"); },
  };
  await expect(recordSpend("p1", 100, 10, "gemini-3.8-flash", store, 0, "karan")).resolves.toBeUndefined();
  expect(totals).toHaveLength(1);
});

test("every agent loop passes its agent name", () => {
  for (const file of ["gemini-loop.ts", "qa-loop.ts", "loop.ts", "claude-loop.ts"]) {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf-8");
    const at = src.indexOf("recordSpend(");
    const call = src.slice(at, src.indexOf(";", at));
    expect({ file, ok: call.includes("agentName") }).toEqual({ file, ok: true });
  }
});
