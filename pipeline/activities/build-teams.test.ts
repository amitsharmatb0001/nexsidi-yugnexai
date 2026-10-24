import { test, expect, afterEach } from "bun:test";
import { runBuilderPhase, groupTasksForHelpers, type PhaseRun, type PhaseTask, type PhaseStore } from "./build-phases.ts";
import { collapsePhasesForTeam, isFoundationTask } from "./build-phases.ts";

// 2026-10-24 (Amit: builders split their work across helpers, like Claude does, to finish faster; all follow the
// approved plan): a phase with two or more tasks runs as a team — the lead writes the shared files (first build only),
// up to 3 helpers build their own tasks at the same time (each writing only its own files), then the lead integrates,
// compares the code to the plan and runs the checks. Brewline's frontend builder made 175 model calls one after another.

const prevTeams = process.env.NEXSIDI_BUILDER_TEAMS;
afterEach(() => {
  if (prevTeams === undefined) delete process.env.NEXSIDI_BUILDER_TEAMS;
  else process.env.NEXSIDI_BUILDER_TEAMS = prevTeams;
});

const task = (name: string, files: string[], size = 2): PhaseTask => ({ description: name, outputFiles: files, phase: 1, size });
const TASKS: PhaseTask[] = [
  task("home", ["app/page.tsx", "components/ui/Hero.tsx"], 3),
  task("about", ["app/about/page.tsx"], 1),
  task("contact", ["app/contact/page.tsx"], 1),
  task("sign in", ["app/(auth)/sign-in/page.tsx", "components/auth/SignInForm.tsx"], 2),
  task("sign up", ["app/(auth)/sign-up/page.tsx", "components/auth/SignUpForm.tsx"], 2),
];
const plan = (tasks: PhaseTask[]) => ({ buildPhases: [{ name: "Foundation", goal: "pages", pages: [], endpoints: [], tables: [] }], aanyaTasks: tasks, shubhamTasks: [] });
const store = (): PhaseStore & { done: number[] } => {
  const done: number[] = [];
  return { done, isDone: (_b, p) => done.includes(p), markDone: (_b, p) => { done.push(p); } };
};

test("tasks are split into at most 3 helpers, balanced by size, never splitting a file between helpers", () => {
  const groups = groupTasksForHelpers(TASKS, 3);
  expect(groups.length).toBe(3);
  const files = groups.flatMap((g) => g.flatMap((t) => t.outputFiles));
  expect(new Set(files).size).toBe(files.length);
  const sizes = groups.map((g) => g.reduce((s, t) => s + (t.size ?? 1), 0)).sort();
  expect(sizes[sizes.length - 1]! - sizes[0]!).toBeLessThanOrEqual(1);
  // two tasks that share a file stay together
  const shared = groupTasksForHelpers([task("a", ["x.ts", "y.ts"]), task("b", ["y.ts"]), task("c", ["z.ts"])], 3);
  expect(shared.some((g) => g.length === 2 && g.every((t) => t.outputFiles.includes("y.ts")))).toBe(true);
});

test("a team: shared files first, helpers at the same time, then the lead — each with the right limits and models", async () => {
  const log: string[] = [];
  const runs: PhaseRun[] = [];
  let running = 0;
  let maxRunning = 0;
  await runBuilderPhase({
    projectId: "p", builder: "aanya", phase: 1, plan: plan(TASKS), store: store(), scaffoldNeeded: true, existingFiles: [],
    runAgent: async (phasePlan, run) => {
      runs.push(run);
      running++;
      maxRunning = Math.max(maxRunning, running);
      log.push(`${run.role} start`);
      await new Promise((r) => setTimeout(r, run.role === "helper" ? 5 : 1));
      log.push(`${run.role} end`);
      running--;
      return { success: true, errors: [], filesWritten: (phasePlan.aanyaTasks as PhaseTask[]).flatMap((t) => t.outputFiles) };
    },
    reportBlocked: () => {},
  });
  expect(runs.map((r) => r.role)).toEqual(["shared", "helper", "helper", "helper", "integrate"]);
  expect(maxRunning).toBe(3); // the three helpers overlapped
  expect(log.indexOf("integrate start")).toBeGreaterThan(log.lastIndexOf("helper end"));
  const shared = runs[0]!;
  expect(shared.scaffold).toBe(true);
  expect(shared.avoidFiles?.sort()).toEqual(TASKS.flatMap((t) => t.outputFiles).sort());
  const helpers = runs.filter((r) => r.role === "helper");
  expect(helpers.map((h) => h.helperIndex).sort()).toEqual([0, 1, 2]);
  expect(helpers.every((h) => !h.scaffold && !h.isLast && (h.ownFiles?.length ?? 0) > 0)).toBe(true);
  expect(runs[4]!.isLast).toBe(true);
});

test("a failed helper is retried once; what it still could not do goes to the lead", async () => {
  const runs: PhaseRun[] = [];
  let helperZeroTries = 0;
  await runBuilderPhase({
    projectId: "p", builder: "aanya", phase: 1, plan: plan(TASKS.slice(0, 2)), store: store(), scaffoldNeeded: false, existingFiles: [],
    runAgent: async (_p, run) => {
      runs.push(run);
      if (run.role === "helper" && run.helperIndex === 0) {
        helperZeroTries++;
        return { success: false, errors: ["tsc: Cannot find name 'Hero'"], filesWritten: [] };
      }
      return { success: true, errors: [], filesWritten: [] };
    },
    reportBlocked: () => {},
  });
  expect(helperZeroTries).toBe(2);
  expect(runs.map((r) => r.role)).toEqual(["helper", "helper", "helper", "integrate"]); // no shared step: not the first build
  const lead = runs[runs.length - 1]!;
  expect(lead.header).toContain("Cannot find name 'Hero'");
});

test("a phase with one task, or teams switched off, keeps the single-builder run", async () => {
  const roles: Array<string | undefined> = [];
  const runOne = (tasks: PhaseTask[]) => runBuilderPhase({
    projectId: "p", builder: "aanya", phase: 1, plan: plan(tasks), store: store(), scaffoldNeeded: false, existingFiles: [],
    runAgent: async (_p, run) => { roles.push(run.role); return { success: true, errors: [], filesWritten: [] }; },
    reportBlocked: () => {},
  });
  await runOne(TASKS.slice(0, 1));
  expect(roles).toEqual([undefined]);
  roles.length = 0;
  process.env.NEXSIDI_BUILDER_TEAMS = "off";
  await runOne(TASKS);
  expect(roles).toEqual([undefined]);
});


// 2026-10-24: in team mode the plan's phases only limited parallelism (Brewline's backend had one task in each of
// phases 2 and 4, so nothing could run beside it). Each helper holds only its own slice, so the whole app is one team
// pass; a task that creates the app's foundation is built by the lead's shared step before the helpers start.
test("foundation tasks are recognised from their files", () => {
  expect(isFoundationTask(task("Configure Express app", ["src/index.ts", "src/app.ts", "src/middleware/auth.ts"]))).toBe(true);
  expect(isFoundationTask(task("auth endpoints", ["src/routes/auth.routes.ts", "src/controllers/auth.controller.ts"]))).toBe(false);
  expect(isFoundationTask(task("layout", ["app/layout.tsx", "lib/api.ts"]))).toBe(true);
  expect(isFoundationTask(task("menu page", ["app/menu/page.tsx"]))).toBe(false);
});

test("the plan's phases collapse into one team pass with every task", () => {
  const p = { buildPhases: [{ name: "A", goal: "a", pages: ["/"], endpoints: ["GET /x"], tables: ["t"] }, { name: "B", goal: "b", pages: ["/b"], endpoints: [], tables: [] }],
    aanyaTasks: [{ ...task("x", ["app/page.tsx"]), phase: 1 }, { ...task("y", ["app/b/page.tsx"]), phase: 2 }], shubhamTasks: [{ ...task("z", ["src/x.ts"]), phase: 2 }] };
  const c = collapsePhasesForTeam(p);
  expect(c.buildPhases!.length).toBe(1);
  expect(c.buildPhases![0]!.pages).toEqual(["/", "/b"]);
  expect([...c.aanyaTasks, ...c.shubhamTasks].every((t) => t.phase === 1)).toBe(true);
});

test("on the first build the foundation task goes to the shared step; the helpers get the rest", async () => {
  const runs: PhaseRun[] = [];
  const tasks = [
    { ...task("Configure Express app", ["src/index.ts", "src/app.ts", "src/middleware/auth.ts"], 4), phase: 1 },
    { ...task("auth endpoints", ["src/routes/auth.routes.ts", "src/controllers/auth.controller.ts"]), phase: 1 },
    { ...task("menu endpoints", ["src/routes/menu.routes.ts", "src/controllers/menu.controller.ts"]), phase: 1 },
    { ...task("orders endpoints", ["src/routes/orders.routes.ts", "src/controllers/orders.controller.ts"]), phase: 1 },
  ];
  await runBuilderPhase({
    projectId: "p", builder: "shubham", phase: 1, plan: { buildPhases: [{ name: "All", goal: "", pages: [], endpoints: [], tables: [] }], aanyaTasks: [], shubhamTasks: tasks },
    store: store(), scaffoldNeeded: true, existingFiles: [],
    runAgent: async (_p, run) => { runs.push(run); return { success: true, errors: [], filesWritten: [] }; },
    reportBlocked: () => {},
  });
  const shared = runs[0]!;
  expect(shared.role).toBe("shared");
  expect(shared.header).toContain("Configure Express app");
  expect(shared.avoidFiles).not.toContain("src/app.ts");
  const helpers = runs.filter((r) => r.role === "helper");
  expect(helpers.length).toBe(3);
  expect(helpers.flatMap((h) => h.ownFiles ?? [])).not.toContain("src/app.ts");
});
