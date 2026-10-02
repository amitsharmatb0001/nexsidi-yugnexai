import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { runBuilderPhase, phaseStepBudget, type PhaseStore, type PhaseRun } from "./build-phases.ts";

// 2026-10-02 (Part C.3, approved by Amit): builders work one phase at a time
// so they do not burn out and stay relevant — a fresh conversation per
// phase with only that phase's tasks, progress saved after each phase, a
// failed phase retried once, then reported and resumed from that phase.

const PHASES = [
  { name: "Foundation", goal: "Accounts and settings", pages: ["/sign-in"], endpoints: [], tables: ["users"] },
  { name: "Clients", goal: "Manage clients", pages: ["/clients"], endpoints: [], tables: ["clients"] },
  { name: "Invoices", goal: "Create invoices", pages: ["/invoices"], endpoints: [], tables: ["invoices"] },
];

const plan = () => ({
  buildPhases: PHASES,
  aanyaTasks: [
    { description: "Sign in page", outputFiles: ["app/(auth)/sign-in/page.tsx"], phase: 1, size: 1 },
    { description: "Clients page", outputFiles: ["app/clients/page.tsx", "components/ClientList.tsx"], phase: 2, size: 2 },
    { description: "Invoices page", outputFiles: ["app/invoices/page.tsx"], phase: 3, size: 1 },
  ],
  shubhamTasks: [] as Array<{ description: string; outputFiles: string[]; phase?: number; size?: number }>,
});

function memoryStore(done: Record<string, number[]> = {}): PhaseStore & { saved: Record<string, number[]> } {
  const saved: Record<string, number[]> = JSON.parse(JSON.stringify(done));
  return {
    saved,
    isDone: (builder, phase) => (saved[builder] ?? []).includes(phase),
    markDone: (builder, phase) => { saved[builder] = [...(saved[builder] ?? []), phase]; },
  };
}

type Call = { tasks: string[]; run: PhaseRun };

function fakeAgent(results: boolean[]) {
  const calls: Call[] = [];
  let i = 0;
  const run = async (p: { aanyaTasks: Array<{ description: string }> }, phaseRun: PhaseRun) => {
    calls.push({ tasks: p.aanyaTasks.map((t) => t.description), run: phaseRun });
    const ok = results[Math.min(i++, results.length - 1)]!;
    return { success: ok, errors: ok ? [] : ["npx next build failed: Type error in app/clients/page.tsx"], filesWritten: [] };
  };
  return { run, calls };
}

const base = (over: Partial<Parameters<typeof runBuilderPhase>[0]> = {}) => ({
  projectId: "p1",
  builder: "aanya" as const,
  phase: 2,
  plan: plan(),
  store: memoryStore(),
  scaffoldNeeded: false,
  existingFiles: ["app/(auth)/sign-in/page.tsx", "app/layout.tsx"],
  reportBlocked: () => {},
  ...over,
});

test("a builder gets only its phase's tasks, in a fresh conversation, with what earlier phases built", async () => {
  const agent = fakeAgent([true]);
  await runBuilderPhase({ ...base(), runAgent: agent.run });
  expect(agent.calls.length).toBe(1);
  expect(agent.calls[0]!.tasks).toEqual(["Clients page"]);
  const r = agent.calls[0]!.run;
  expect(r.conversationKey).toBe("aanya-phase-2");
  expect(r.header).toContain("PHASE 2 of 3 — Clients: Manage clients");
  expect(r.header).toContain("Foundation");          // earlier phase named
  expect(r.header).toContain("app/(auth)/sign-in/page.tsx"); // earlier files listed
  expect(r.isLast).toBe(false);
  expect(r.scaffold).toBe(false);
});

test("progress is saved after each phase, and a finished phase is skipped on a retry", async () => {
  const store = memoryStore();
  const agent = fakeAgent([true]);
  await runBuilderPhase({ ...base({ store }), runAgent: agent.run });
  expect(store.saved.aanya).toEqual([2]);
  const again = fakeAgent([true]);
  await runBuilderPhase({ ...base({ store }), runAgent: again.run });
  expect(again.calls.length).toBe(0);
});

test("a phase with no tasks for this builder is marked done without running it", async () => {
  const store = memoryStore();
  const agent = fakeAgent([true]);
  await runBuilderPhase({ ...base({ store, builder: "shubham" }), runAgent: agent.run });
  expect(agent.calls.length).toBe(0);
  expect(store.saved.shubham).toEqual([2]);
});

test("a failed phase is retried once with what went wrong, in the same phase conversation", async () => {
  const agent = fakeAgent([false, true]);
  const store = memoryStore();
  await runBuilderPhase({ ...base({ store }), runAgent: agent.run });
  expect(agent.calls.length).toBe(2);
  expect(agent.calls[1]!.run.conversationKey).toBe("aanya-phase-2");
  expect(agent.calls[1]!.run.header).toContain("Type error in app/clients/page.tsx");
  expect(agent.calls[1]!.run.scaffold).toBe(false);
  expect(store.saved.aanya).toEqual([2]);
});

test("a phase that fails twice is reported to Tilotma and stops the run at that phase", async () => {
  const agent = fakeAgent([false, false]);
  const store = memoryStore();
  const reports: string[] = [];
  await expect(runBuilderPhase({ ...base({ store, reportBlocked: (what) => reports.push(what) }), runAgent: agent.run })).rejects.toThrow();
  expect(reports.join(" ")).toContain("phase 2");
  expect(store.saved.aanya ?? []).toEqual([]);
});

test("the starter files are written only on the builder's first phase, and the last phase runs the full checks", async () => {
  const agent = fakeAgent([true]);
  await runBuilderPhase({ ...base({ phase: 1, scaffoldNeeded: true }), runAgent: agent.run });
  expect(agent.calls[0]!.run.scaffold).toBe(true);
  const last = fakeAgent([true]);
  await runBuilderPhase({ ...base({ phase: 3 }), runAgent: last.run });
  expect(last.calls[0]!.run.isLast).toBe(true);
});

test("a phase's starting step budget follows the size of its tasks", () => {
  const small = phaseStepBudget([{ size: 1 }]);
  const big = phaseStepBudget([{ size: 4 }, { size: 3 }, { size: 2 }]);
  expect(big).toBeGreaterThan(small);
  expect(small).toBeGreaterThanOrEqual(20);
});

test("the workflow builds phase by phase, the database once in phase 1, and keeps the old path for plans without phases", () => {
  const wf = readFileSync(new URL("../workflows/project-build.ts", import.meta.url), "utf-8");
  expect(wf).toContain('patched("generation-phases-v1")');
  expect(wf).toContain("genAct.runAanyaPhase(projectId, phase)");
  expect(wf).toContain("genAct.runShubhamPhase(projectId, phase)");
  expect(wf).toMatch(/phase === 1[^\n]*genAct\.runPranav\(projectId\)/);
  expect(wf).toContain("genAct.runAanya(projectId)");
});

test("the builders use the phase's conversation, extend steps while progressing, and skip the starter files after phase 1", () => {
  for (const file of ["../../agents/generators/aanya/src/index.ts", "../../agents/generators/shubham/src/index.ts"]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf-8");
    expect({ file, key: src.includes("conversationKey: phase?.conversationKey") }).toEqual({ file, key: true });
    expect({ file, extend: src.includes("extendStepsWhileProgressing: Boolean(phase)") }).toEqual({ file, extend: true });
    expect({ file, scaffold: src.includes("if (!phase || phase.scaffold)") }).toEqual({ file, scaffold: true });
  }
});
