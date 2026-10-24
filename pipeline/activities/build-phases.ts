// Phase-by-phase generation (Part C.3 of the agentic planner plan, approved
// by Amit, 2 Oct 2026). Builders used to carry the whole app in one
// conversation — 10 pages, ~18,000 tokens of rules and every earlier step —
// in one 90-step attempt. They ran out of steps and context and lost focus.
// Now each builder works one phase at a time: a fresh conversation with only
// that phase's tasks and a short summary of what earlier phases built.
// Progress is saved after each phase; a failed phase is retried once with
// what went wrong, then reported to Tilotma, and a Retry resumes from that
// phase — never from the start.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type PhaseBuilder = "aanya" | "shubham";

export interface PhaseTask {
  description: string;
  outputFiles: string[];
  phase?: number;
  size?: number;
}

export interface PlanPhase {
  name: string;
  goal: string;
  pages: string[];
  endpoints: string[];
  tables: string[];
}

/** What a builder needs to run one phase. */
export interface PhaseRun {
  number: number;
  total: number;
  conversationKey: string;
  header: string;      // prepended to the builder's task: which phase, what exists, what is next
  scaffold: boolean;   // write the starter files (only on the builder's first phase)
  isLast: boolean;     // the last phase also runs the full end-of-build checks
  maxSteps: number;    // starting budget; the run is extended while it keeps making progress
}

export interface PhaseStore {
  isDone(builder: PhaseBuilder, phase: number): boolean;
  markDone(builder: PhaseBuilder, phase: number): void;
}

export interface PhaseAgentResult {
  success: boolean;
  errors: string[];
  filesWritten: string[];
}

type PlanWithTasks = { buildPhases?: PlanPhase[]; aanyaTasks: PhaseTask[]; shubhamTasks: PhaseTask[] };

/** Starting steps for a phase: verification overhead plus room per file. Extended while progressing. */
export function phaseStepBudget(tasks: Array<{ size?: number }>): number {
  const units = tasks.reduce((sum, t) => sum + Math.max(1, t.size ?? 1), 0);
  return 20 + 8 * units;
}

function tasksKey(builder: PhaseBuilder): "aanyaTasks" | "shubhamTasks" {
  return builder === "aanya" ? "aanyaTasks" : "shubhamTasks";
}

function phaseHeader(
  builder: PhaseBuilder,
  phases: PlanPhase[],
  n: number,
  existingFiles: string[],
  retryNote?: string,
): string {
  const ph = phases[n - 1]!;
  const isLast = n === phases.length;
  const earlier = phases.slice(0, n - 1).map((p, i) => `  ${i + 1}. ${p.name} — ${p.goal}`);
  const later = phases.slice(n).map((p, i) => `  ${n + i + 1}. ${p.name} — ${p.goal}`);
  const files = existingFiles.slice(0, 300);
  const checks = isLast
    ? "This is the LAST phase: when your tasks are done, run the full end-of-build checks your instructions describe for the whole app."
    : builder === "aanya"
      ? "Not the last phase: get `npx tsc --noEmit` and `npx next build` passing for what you wrote. The click-through and visual checks run in the last phase, when every page exists."
      : "Not the last phase: get `npx tsc --noEmit` and `npm run build` passing for what you wrote. The live endpoint checks run in the last phase, when every endpoint exists.";
  return [
    `BUILD PHASE ${n} of ${phases.length} — ${ph.name}: ${ph.goal}`,
    "You build ONLY this phase's tasks, listed below. Stay focused on them.",
    earlier.length ? `Earlier phases are already built — reuse their components, helpers and styles; change their files only when a task here needs it:\n${earlier.join("\n")}` : "This is the first phase.",
    files.length ? `Files already in your folder:\n${files.map((f) => `  ${f}`).join("\n")}` : "",
    later.length ? `Later phases (not yours now — do not build them):\n${later.join("\n")}` : "",
    checks,
    retryNote ? `YOUR PREVIOUS ATTEMPT AT THIS PHASE FAILED — fix the cause:\n${retryNote}` : "",
  ].filter(Boolean).join("\n\n");
}

export async function runBuilderPhase(args: {
  projectId: string;
  builder: PhaseBuilder;
  phase: number;
  plan: PlanWithTasks;
  store: PhaseStore;
  scaffoldNeeded: boolean;
  existingFiles: string[];
  runAgent: (phasePlan: PlanWithTasks, run: PhaseRun) => Promise<PhaseAgentResult>;
  reportBlocked: (what: string, checked: string) => void;
}): Promise<{ skipped: boolean; filesWritten: string[] }> {
  const { builder, phase, plan, store } = args;
  const phases = plan.buildPhases ?? [];
  if (store.isDone(builder, phase)) return { skipped: true, filesWritten: [] };

  const key = tasksKey(builder);
  const tasks = plan[key].filter((t) => (t.phase ?? 1) === phase);
  if (tasks.length === 0) {
    store.markDone(builder, phase);
    return { skipped: true, filesWritten: [] };
  }

  const phasePlan = { ...plan, [key]: tasks } as PlanWithTasks;
  const makeRun = (scaffold: boolean, retryNote?: string): PhaseRun => ({
    number: phase,
    total: phases.length,
    conversationKey: `${builder}-phase-${phase}`,
    header: phaseHeader(builder, phases, phase, args.existingFiles, retryNote),
    scaffold,
    isLast: phase === phases.length,
    maxSteps: phaseStepBudget(tasks),
  });

  let result = await args.runAgent(phasePlan, makeRun(args.scaffoldNeeded));
  if (!result.success) {
    console.log(`[phases] ${builder} phase ${phase} failed — retrying once with what went wrong`);
    result = await args.runAgent(phasePlan, makeRun(false, result.errors.join("\n").slice(0, 3000)));
  }
  if (!result.success) {
    args.reportBlocked(
      `${builder} could not finish build phase ${phase} (${phases[phase - 1]?.name ?? ""}) after a retry`,
      result.errors.join("\n").slice(0, 1000),
    );
    throw new Error(`${builder} phase ${phase} failed after a retry: ${result.errors.join("; ").slice(0, 500)}`);
  }
  store.markDone(builder, phase);
  console.log(`[phases] ${builder} phase ${phase} of ${phases.length} done (${result.filesWritten.length} files)`);
  return { skipped: false, filesWritten: result.filesWritten };
}

/** Files already in a builder's folder, for the next phase's summary. */
export function listBuiltFiles(dir: string): string[] {
  const skip = new Set(["node_modules", ".next", ".git", ".nexsidi-evidence", "fonts", "dist"]);
  const out: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      if (skip.has(name) || name.startsWith(".")) continue;
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).replace(/\\/g, "/"));
    }
  };
  walk(dir);
  return out.sort();
}
