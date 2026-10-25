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
  // 2026-10-24 (builder teams, see runBuilderPhase): which step of a team this run is. Absent = the single-builder run.
  //   shared    — the lead writes the files every task uses (first build only); may not write any task's own files
  //   helper    — builds its own tasks at the same time as the other helpers; may write only its own files
  //   integrate — the lead makes the whole build pass, compares the code to the plan and runs the checks
  role?: "shared" | "helper" | "integrate";
  ownFiles?: string[];   // helper: its tasks' files (from the approved plan)
  avoidFiles?: string[]; // shared step: every task's files, which the helpers write
  helperIndex?: number;  // helper: which one (it starts on that model of its tier)
}

export interface PhaseStore {
  isDone(builder: PhaseBuilder, phase: number): boolean;
  markDone(builder: PhaseBuilder, phase: number): void;
  // 2026-10-25 (brewline3): a team's shared files and helpers ("prepare") are saved apart from the lead's integration, so the frontend can
  // prepare while the backend builds and a Retry resumes at the lead's step. Optional: a store without them always runs the whole team.
  isPrepared?(builder: PhaseBuilder, phase: number): boolean;
  markPrepared?(builder: PhaseBuilder, phase: number): void;
}

/** all: the whole phase (the default); prepare: a team's shared files and helpers only; integrate: the lead's step (the whole team if no prepare is saved). */
export type PhaseStage = "all" | "prepare" | "integrate";

export interface PhaseAgentResult {
  success: boolean;
  errors: string[];
  filesWritten: string[];
}

type PlanWithTasks = { buildPhases?: PlanPhase[]; aanyaTasks: PhaseTask[]; shubhamTasks: PhaseTask[] };

/**
 * Splits a phase's tasks across at most `max` helpers, balanced by size (largest first, each to the lightest helper).
 * Tasks that share a file go to the same helper, so no file is written by two helpers.
 */
export function groupTasksForHelpers(tasks: PhaseTask[], max: number): PhaseTask[][] {
  // Join tasks that share a file into one unit.
  const units: PhaseTask[][] = [];
  for (const t of tasks) {
    const touching = units.filter((u) => u.some((x) => x.outputFiles.some((f) => t.outputFiles.includes(f))));
    const merged = [t, ...touching.flat()];
    for (const u of touching) units.splice(units.indexOf(u), 1);
    units.push(merged);
  }
  const size = (u: PhaseTask[]) => u.reduce((s, t) => s + Math.max(1, t.size ?? 1), 0);
  const groups: PhaseTask[][] = Array.from({ length: Math.min(max, units.length) }, () => []);
  for (const u of [...units].sort((a, b) => size(b) - size(a))) {
    const lightest = groups.reduce((best, g) => (size(g) < size(best) ? g : best), groups[0]!);
    lightest.push(...u);
  }
  return groups.filter((g) => g.length > 0);
}

// A task that creates the app's foundation — the entry/app setup, middleware, the root layout, the API client, the
// database connection — is what every other task imports, so on the first build the lead's shared step builds it
// before the helpers start (Brewline: "Configure Express app, JWT auth middleware" would otherwise run beside the auth
// endpoints that import it).
const FOUNDATION_FILE = /(^|\/)(index|app|server)\.ts$|(^|\/)middleware\/|(^|\/)app\/layout\.tsx$|(^|\/)lib\/(api|auth)\.ts$|(^|\/)db\/(pool|client|index)\.ts$/;
export function isFoundationTask(t: PhaseTask): boolean {
  return t.outputFiles.some((f) => FOUNDATION_FILE.test(f.replace(/\\/g, "/")));
}

/**
 * In team mode the plan's phases only limited parallelism (Brewline's backend had one task in each of phases 2 and 4).
 * Each helper holds only its own slice, so the whole app becomes one team pass with every task.
 */
export function collapsePhasesForTeam<P extends PlanWithTasks>(plan: P): P {
  const phases = plan.buildPhases ?? [];
  if (phases.length <= 1) return plan;
  const merged: PlanPhase = {
    name: "The whole app",
    goal: phases.map((p) => p.goal).filter(Boolean).join("; "),
    pages: phases.flatMap((p) => p.pages ?? []),
    endpoints: phases.flatMap((p) => p.endpoints ?? []),
    tables: phases.flatMap((p) => p.tables ?? []),
  };
  return {
    ...plan,
    buildPhases: [merged],
    aanyaTasks: plan.aanyaTasks.map((t) => ({ ...t, phase: 1 })),
    shubhamTasks: plan.shubhamTasks.map((t) => ({ ...t, phase: 1 })),
  };
}

/** Builder teams are on unless NEXSIDI_BUILDER_TEAMS=off. */
export function builderTeamsOn(): boolean {
  return process.env.NEXSIDI_BUILDER_TEAMS !== "off";
}

const MAX_HELPERS = 3;

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
  stage?: PhaseStage;
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

  if (builderTeamsOn() && tasks.length >= 2) {
    return runAsTeam(args, tasks, makeRun, args.stage ?? "all");
  }
  if (args.stage === "prepare") return { skipped: true, filesWritten: [] }; // nothing to prepare: the integrate step does all of it

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

// 2026-10-24 (Amit: builders split their work across helpers, like Claude does, to finish faster; everything follows the
// approved plan). Brewline's frontend builder made 175 model calls one after another. A phase with two or more tasks
// runs as a team:
//   1. shared    — the lead (pro model) writes the files every task uses: layout, header/footer, the theme with the
//                  approved colours, the API client (backend: app, middleware, database). First build only.
//   2. helpers   — up to 3 at the same time (flash models, each starting on a different one), each building its own
//                  tasks and writing only its own files; a failed helper is retried once, then its tasks go to the lead.
//   3. integrate — the lead makes the whole build pass, finishes anything left, makes shared changes, compares the
//                  code to the plan and runs the checks (the full end-of-build checks in the last phase).
type TeamArgs = Parameters<typeof runBuilderPhase>[0];

async function runAsTeam(
  args: TeamArgs,
  tasks: PhaseTask[],
  makeRun: (scaffold: boolean, retryNote?: string) => PhaseRun,
  stage: PhaseStage = "all",
): Promise<{ skipped: boolean; filesWritten: string[] }> {
  const { builder, phase, plan, store } = args;
  const key = tasksKey(builder);
  // The lead's step after a saved prepare does not repeat the shared files and the helpers.
  const prepared = stage === "integrate" && store.isPrepared?.(builder, phase) === true;
  const base = makeRun(false);
  const written = new Set<string>();
  const planWith = (ts: PhaseTask[]) => ({ ...plan, [key]: ts }) as PlanWithTasks;
  const list = (ts: PhaseTask[]) => ts.map((t) => `  - ${t.description} -> ${t.outputFiles.join(", ")}`).join("\n");
  // On the first build the lead's shared step also builds the foundation tasks; the helpers get the rest.
  const foundation = args.scaffoldNeeded ? tasks.filter(isFoundationTask) : [];
  const helperTasks = tasks.filter((t) => !foundation.includes(t));
  const groups = groupTasksForHelpers(helperTasks, MAX_HELPERS);
  const helperFiles = helperTasks.flatMap((t) => t.outputFiles);

  if (args.scaffoldNeeded && !prepared) {
    const header = [
      base.header,
      `TEAM STEP 1 of 3 — SHARED FILES. You are the lead of a team. Write the files every task below will use:\n` +
        (builder === "aanya"
          ? "the root layout, header and footer, the theme with the approved design's colours and fonts, the API client and shared types/helpers."
          : "the app setup, middleware (auth, errors), the database connection and shared types/helpers.") +
        (foundation.length > 0 ? `\nBuild these foundation tasks fully yourself:\n${list(foundation)}` : "") +
        `\nDo NOT write the other tasks' files — ${groups.length} helpers write them next, at the same time:\n${list(helperTasks)}\n` +
        "Get the type check passing for what you wrote, then call task_complete.",
    ].join("\n\n");
    const shared = await args.runAgent(planWith(tasks), { ...makeRun(true), role: "shared", avoidFiles: helperFiles, header, isLast: false, maxSteps: 40 + (foundation.length > 0 ? phaseStepBudget(foundation) : 0), conversationKey: `${builder}-phase-${phase}-shared` });
    for (const f of shared.filesWritten) written.add(f);
    if (!shared.success) console.log(`[phases] ${builder} phase ${phase}: shared-files step did not finish — the helpers and the lead go on`);
  }

  const runHelper = async (group: PhaseTask[], i: number) => {
    const header = [
      base.header,
      `TEAM STEP 2 of 3 — you are helper ${i + 1} of ${groups.length}; the others work at the same time. Build ONLY these tasks:\n${list(group)}\n` +
        "You may write only these files, new files in their folders, and tests beside them. Shared files (layout, theme, API " +
        "client, middleware) already exist — use them; if one needs a change, say exactly what in your task_complete summary " +
        "and the lead makes it. Follow the APPROVED PLAN exactly (contract, design) and compare your code to it — no guessing.\n" +
        (builder === "shubham"
          ? "Write unit tests for the logic you write (validation, calculations, data mapping) as <file>.test.ts beside it, using " +
            "node:test and node:assert with relative imports; they run when the lead builds. "
          : "") +
        "Get `npx tsc --noEmit` passing. Do not run a build, containers or a browser — the lead does that once for the whole team.",
    ].join("\n\n");
    const run: PhaseRun = { ...base, role: "helper", helperIndex: i, ownFiles: group.flatMap((t) => t.outputFiles), header, scaffold: false, isLast: false, maxSteps: phaseStepBudget(group), conversationKey: `${builder}-phase-${phase}-helper-${i}` };
    let r = await args.runAgent(planWith(group), run);
    if (!r.success) {
      console.log(`[phases] ${builder} phase ${phase} helper ${i + 1} did not finish — retrying once with what went wrong`);
      r = await args.runAgent(planWith(group), { ...run, header: `${header}\n\nYOUR PREVIOUS ATTEMPT FAILED — fix the cause:\n${r.errors.join("\n").slice(0, 2000)}` });
    }
    return { group, result: r };
  };
  const helpers = prepared ? [] : await Promise.all(groups.map((g, i) => runHelper(g, i)));
  for (const h of helpers) for (const f of h.result.filesWritten) written.add(f);
  let unfinished: Array<{ group: PhaseTask[]; result: { errors: string[] } }> = helpers.filter((h) => !h.result.success);
  if (prepared) {
    // Whatever the prepare left unwritten goes to the lead, found from the files that really exist now.
    const slash = (f: string) => f.split("\\").join("/");
    const present = new Set(args.existingFiles.map(slash));
    const missing = tasks.filter((t) => t.outputFiles.some((f) => !present.has(slash(f))));
    if (missing.length > 0) unfinished = [{ group: missing, result: { errors: ["its files were not written before the lead's step"] } }];
  }
  if (stage === "prepare") {
    store.markPrepared?.(builder, phase);
    console.log(`[phases] ${builder} phase ${phase}: shared files and ${groups.length} helpers done beside the other builder (${written.size} files) — the lead integrates next`);
    return { skipped: false, filesWritten: [...written] };
  }

  const leadHeader = (retryNote?: string) =>
    [
      base.header,
      `TEAM STEP 3 of 3 — you are the lead. ${groups.length} helpers built these tasks at the same time:\n${list(helperTasks)}\n` +
        (unfinished.length > 0
          ? `NOT finished by a helper — finish them yourself:\n${unfinished.map((h) => `${list(h.group)}\n    (what went wrong: ${h.result.errors.join("; ").slice(0, 600)})`).join("\n")}\n`
          : "") +
        "Now: read what the helpers wrote, make any shared-file changes they asked for, make the whole build pass, and compare " +
        "the code to the APPROVED PLAN — every task's files exist and do what the task says, every contract endpoint it covers " +
        "is implemented, the approved design is used. Then run the checks your instructions describe.",
      retryNote ? `YOUR PREVIOUS ATTEMPT FAILED — fix the cause:\n${retryNote}` : "",
    ].filter(Boolean).join("\n\n");
  const leadRun = (retryNote?: string): PhaseRun => ({ ...base, role: "integrate", header: leadHeader(retryNote), scaffold: false, maxSteps: 20 + 4 * tasks.length + (unfinished.length > 0 ? phaseStepBudget(unfinished.flatMap((h) => h.group)) : 0), conversationKey: `${builder}-phase-${phase}-lead` });
  let lead = await args.runAgent(planWith(tasks), leadRun());
  if (!lead.success) {
    console.log(`[phases] ${builder} phase ${phase}: the lead's integration failed — retrying once with what went wrong`);
    lead = await args.runAgent(planWith(tasks), leadRun(lead.errors.join("\n").slice(0, 3000)));
  }
  if (!lead.success) {
    args.reportBlocked(`${builder} could not finish build phase ${phase} as a team after a retry`, lead.errors.join("\n").slice(0, 1000));
    throw new Error(`${builder} phase ${phase} failed after a retry: ${lead.errors.join("; ").slice(0, 500)}`);
  }
  for (const f of lead.filesWritten) written.add(f);
  store.markDone(builder, phase);
  console.log(`[phases] ${builder} phase ${phase} done as a team of ${groups.length} helpers (${written.size} files)`);
  return { skipped: false, filesWritten: [...written] };
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
