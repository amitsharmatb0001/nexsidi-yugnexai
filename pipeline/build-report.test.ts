import { test, expect } from "bun:test";
import { buildWindows, aggregate, renderReport, type Activity, type RoundMark } from "./build-report.ts";
import type { CallRow } from "../packages/llm-client/src/call-ledger.ts";

// 2026-10-25 (Amit: "a fully detailed costing and timing of each agent, each round, not an overview report"). The report is built from
// recorded facts only: the per-call ledger (model, start and end, tokens, cache, agent, ok/failed), the workflow's own step times and
// the review rounds. Nothing is estimated; what the ledger could not attribute or price is listed as such.

const T0 = Date.parse("2026-10-25T10:00:00Z");
const at = (min: number, sec = 0) => T0 + min * 60_000 + sec * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

const ACTIVITIES: Activity[] = [
  { name: "runArjun", start: at(0), end: at(4) },
  { name: "runShubhamPhase", start: at(4), end: at(15) },
  { name: "runQAFixLoopActivity", start: at(20), end: at(40) },
  { name: "runDeployWithLiveRetest", start: at(41), end: at(80) },
];
const ROUNDS: RoundMark[] = [
  { at: at(25), stage: "qa", findings: 3 },
  { at: at(33), stage: "qa", findings: 0 },
  { at: at(60), stage: "live", findings: 2 },
  { at: at(75), stage: "live", findings: 0 },
];

test("a step with review rounds is split into one window per round, plus the part after the last round", () => {
  const w = buildWindows(ACTIVITIES, ROUNDS, at(85));
  const labels = w.map((x) => x.label);
  expect(labels).toEqual([
    "runArjun",
    "runShubhamPhase",
    "waiting (between steps)",
    "code review round 1 (3 findings)",
    "code review round 2 (0 findings)",
    "code review: after the last round",
    "waiting (between steps)",
    "live round 1 (2 findings)",
    "live round 2 (0 findings)",
    "deploy and live checks: after the last round",
  ]);
  for (let i = 1; i < w.length; i++) expect(w[i]!.from).toBe(w[i - 1]!.to); // the windows tile the timeline
});

function row(agent: string | undefined, model: string, endMin: number, ms: number, ok: boolean, tokens?: { in: number; out: number; cached?: number }, endSec = 0): CallRow {
  const end = at(endMin, endSec);
  return {
    at: iso(end), startedAt: iso(end - ms), ms, kind: "tools", model, ok, projectId: "p1",
    ...(agent ? { agent } : {}), ...(ok ? {} : { error: "AbortError: The operation was aborted." }),
    ...(tokens ? { tokensIn: tokens.in, tokensOut: tokens.out, ...(tokens.cached ? { cachedIn: tokens.cached } : {}) } : {}),
  };
}
const PRICE = (model: string, tin: number, tout: number, cached: number) => ((tin - cached) * 1 + cached * 0.1 + tout * 5) / 1_000_000;

test("each call is assigned to the window it ended in, and summed per agent with its own time, tokens, cache and cost", () => {
  const windows = buildWindows(ACTIVITIES, ROUNDS, at(85));
  const rows = [
    row("shubham", "gemini-3.5-flash", 6, 20_000, true, { in: 100_000, out: 2_000, cached: 40_000 }),
    row("shubham", "gemini-3.5-flash", 8, 30_000, true, { in: 120_000, out: 3_000, cached: 90_000 }),
    row("navya", "gemini-4-argon", 24, 60_000, true, { in: 50_000, out: 4_000 }),
    row("navya", "gemini-3.8-flash", 22, 120_000, false),
    row("karan", "gemini-3.1-pro-preview", 23, 90_000, true, { in: 50_000, out: 3_000 }),
    row("aanya", "gemini-3.5-flash", 30, 10_000, true, { in: 80_000, out: 1_000 }), // the fix before round 2
  ];
  const report = aggregate(rows, windows, PRICE);
  const arjun = report.sections.find((s) => s.label === "runArjun")!;
  expect(arjun.agents.length).toBe(0);
  const shub = report.sections.find((s) => s.label === "runShubhamPhase")!;
  expect(shub.agents).toHaveLength(1);
  expect(shub.agents[0]).toMatchObject({ agent: "shubham", callsOk: 2, callsFailed: 0, tokensIn: 220_000, tokensOut: 5_000, cachedIn: 130_000 });
  expect(shub.agents[0]!.cachePct).toBeCloseTo(59.1, 0);
  expect(shub.agents[0]!.callSeconds).toBe(50);
  const r1 = report.sections.find((s) => s.label.startsWith("code review round 1"))!;
  const navya = r1.agents.find((a) => a.agent === "navya")!;
  expect(navya).toMatchObject({ callsOk: 1, callsFailed: 1, failedSeconds: 120, okSeconds: 60 });
  expect(navya.models).toEqual({ "gemini-4-argon": 1, "gemini-3.8-flash": 1 });
  expect(navya.costUsd).toBeCloseTo(PRICE("x", 50_000, 4_000, 0), 6);
  const r2 = report.sections.find((s) => s.label.startsWith("code review round 2"))!;
  expect(r2.agents.map((a) => a.agent)).toEqual(["aanya"]);
  // totals add up exactly
  expect(report.total.callsOk + report.total.callsFailed).toBe(rows.length);
  expect(report.total.costUsd).toBeCloseTo(rows.reduce((s, r) => s + (r.ok ? PRICE("x", r.tokensIn ?? 0, r.tokensOut ?? 0, r.cachedIn ?? 0) : 0), 0), 6);
});

test("a call with no agent is listed as unattributed, a model with no price is flagged, and a call outside every window is not lost", () => {
  const windows = buildWindows(ACTIVITIES, ROUNDS, at(85));
  const rows = [row(undefined, "gemini-3.1-pro-preview", 2, 5_000, true, { in: 7_000, out: 700 }), row("x", "mystery-model", 3, 1_000, true, { in: 1, out: 1 }), row("late", "gemini-3.5-flash", 200, 1_000, true, { in: 10, out: 10 })];
  const report = aggregate(rows, windows, (m, a, b, c) => (m === "mystery-model" ? NaN : PRICE(m, a, b, c)));
  const arjun = report.sections.find((s) => s.label === "runArjun")!;
  expect(arjun.agents.map((a) => a.agent)).toEqual(["(no agent named)", "x"]);
  expect(report.unpriced).toEqual(["mystery-model"]);
  expect(report.total.callsOk).toBe(3);
  expect(report.sections[report.sections.length - 1]!.label).toBe("after the build ended");
});

test("the written report names every agent in every window with calls, time, tokens, cache and cost, then totals, failures and the reconciliation", () => {
  const windows = buildWindows(ACTIVITIES, ROUNDS, at(85));
  const rows = [
    row("shubham", "gemini-3.5-flash", 6, 20_000, true, { in: 100_000, out: 2_000, cached: 40_000 }),
    row("navya", "gemini-3.8-flash", 22, 120_000, false),
    row("navya", "gemini-4-argon", 24, 60_000, true, { in: 50_000, out: 4_000 }),
  ];
  const md = renderReport("Brewline 3", aggregate(rows, windows, PRICE), { agentSpendUsd: 0.5, workflowMinutes: 85 });
  expect(md).toContain("## runShubhamPhase");
  expect(md).toContain("## code review round 1 (3 findings)");
  expect(md).toMatch(/\| shubham \| 1 \| 0 \|/);
  expect(md).toMatch(/\| navya \| 1 \| 1 \|/);
  expect(md).toContain("## Failed calls");
  expect(md).toContain("gemini-3.8-flash");
  expect(md).toContain("AbortError");
  expect(md).toContain("## Totals by agent");
  expect(md).toContain("## Totals by model");
  expect(md).toContain("agent_spend");
  expect(md).toContain("85 min");
});
