import { test, expect, mock, beforeEach, afterEach, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 2026-11-02 (Brewline 7): the free proofs before that run called the foundation directly and never ran the real builders' team steps,
// so three faults were found only in a paid run: a team step's limit replaced the foundation's, the frontend's foundation was never
// written, and an import was missing. These run the real phase steps, the real builders and the real tools; only the model is a script.
process.env.GENERATOR_TIER = "gemini";
const real = await import("@nexsidi/llm-client");
const realRoute = real.routeToolsWithFallback;
let active = false;

type Call = { name: string; input: Record<string, unknown> };
type Script = (step: string, turn: number) => Call[];
let script: Script = () => [];
const firstMessages = new Map<string, string>();
const answers = new Map<string, string[]>();
const turns = new Map<string, number>();

const stepOf = (first: string) => {
  const helper = first.match(/you are helper (\d+) of/);
  if (helper) return "helper-" + helper[1];
  if (first.includes("SHARED FILES")) return "shared";
  if (first.includes("you are the lead")) return "lead";
  return "other";
};

mock.module("@nexsidi/llm-client", () => ({
  ...real,
  routeToolsWithFallback: async (...args: Parameters<typeof real.routeToolsWithFallback>) => {
    if (!active) return realRoute(...args);
    const messages = args[1] as Array<{ role: string; content: unknown }>;
    const first = String(messages.find((m) => m.role === "user" && typeof m.content === "string")?.content ?? "");
    const step = stepOf(first);
    const turn = turns.get(step) ?? 0;
    turns.set(step, turn + 1);
    if (!firstMessages.has(step)) firstMessages.set(step, first);
    const last = messages[messages.length - 1]!;
    answers.set(step, [...(answers.get(step) ?? []), JSON.stringify(last.content)]);
    const toolCalls = script(step, turn).map((c, i) => ({ id: step + turn + i, name: c.name, input: c.input }));
    return { content: "", toolCalls, stopReason: "STOP", modelUsed: "fake-model", promptTokens: 10, completionTokens: 5, rawParts: toolCalls.map((c) => ({ functionCall: { name: c.name, args: c.input } })) };
  },
}));
const { runBuilderPhase } = await import("./build-phases.ts");
const shubham = await import("../../agents/generators/shubham/src/index.ts");
const aanya = await import("../../agents/generators/aanya/src/index.ts");
const { foundationChanges } = await import("../../packages/foundation/src/index.ts");
const { FALLBACK_BRIEF } = await import("../../agents/vanya/src/index.ts");

// Saved conversations and spend are real database rows: each test has its own project and removes them after.
const usedIds = new Set<string>();
const newId = () => {
  const id = `teamreal${Date.now().toString(36)}${usedIds.size}`;
  usedIds.add(id);
  return id;
};
async function removeRows() {
  const { db } = await import("@nexsidi/db");
  const { sql } = await import("drizzle-orm");
  for (const id of usedIds) {
    for (const table of ["agent_conversations", "agent_spend", "token_spend"]) {
      await db.execute(sql.raw(`DELETE FROM ${table} WHERE project_id = '${id}'`)).catch(() => {});
    }
  }
  usedIds.clear();
}

let build = "";
const prevBuild = process.env.BUILD_DIR;
const write = (path: string, content = "export const x = 1;\n"): Call => ({ name: "write_file", input: { path, content } });
const done: Call = { name: "task_complete", input: { summary: "done", files_written: [], verification_passed: true } };
const stop: Call = { name: "report_blocked", input: { owner: "tilotma", what: "script ends here", checked: "script" } };

const plan = (projectId: string) => ({
  projectId,
  appName: "Shop",
  appDescription: "A shop",
  sharedTypes: "export type A = string;",
  apiContract: { baseUrl: "http://localhost:3001", endpoints: [{ method: "POST", path: "/api/v1/auth/sign-up", description: "", auth: false }, { method: "POST", path: "/api/v1/auth/sign-in", description: "", auth: false }] },
  dbSchema: { tables: [{ name: "users", columns: [{ name: "id" }, { name: "email" }, { name: "password_hash" }, { name: "role" }] }] },
  buildPhases: [{ name: "All", goal: "The whole app" }],
  shubhamTasks: [
    { description: "Menu routes", outputFiles: ["src/routes/menu.ts"], phase: 1 },
    { description: "Order routes", outputFiles: ["src/routes/orders.ts"], phase: 1 },
  ],
  aanyaTasks: [
    { description: "Menu page", outputFiles: ["app/menu/page.tsx"], phase: 1 },
    { description: "Order page", outputFiles: ["app/order/page.tsx"], phase: 1 },
  ],
  features: [],
  designBrief: FALLBACK_BRIEF,
});

const store = () => {
  const finished = new Set<string>();
  return { isDone: (b: string, p: number) => finished.has(b + p), markDone: (b: string, p: number) => void finished.add(b + p) };
};

async function runTeam(builder: "shubham" | "aanya", id: string) {
  const p = plan(id) as never;
  const blocked: string[] = [];
  await runBuilderPhase({
    projectId: id,
    builder,
    phase: 1,
    plan: p,
    store: store() as never,
    scaffoldNeeded: builder === "shubham",
    existingFiles: [],
    runAgent: async (phasePlan: never, run: never) => {
      const r = builder === "shubham" ? await shubham.run(phasePlan, run) : await aanya.run(phasePlan, "integrate", run);
      return { success: r.success, errors: r.errors, filesWritten: r.filesWritten };
    },
    reportBlocked: (what: string) => void blocked.push(what),
  }).catch((err: unknown) => blocked.push(String(err)));
  return blocked;
}

beforeEach(() => {
  build = mkdtempSync(join(tmpdir(), "team-real-"));
  process.env.BUILD_DIR = build;
  firstMessages.clear();
  answers.clear();
  turns.clear();
  active = true;
});

afterEach(async () => {
  active = false;
  await removeRows();
  if (prevBuild === undefined) delete process.env.BUILD_DIR;
  else process.env.BUILD_DIR = prevBuild;
  rmSync(build, { recursive: true, force: true });
});

afterAll(() => {
  delete process.env.GENERATOR_TIER;
});

test("backend: the foundation is written, every team step is refused its files, and the helpers finish", async () => {
  const id = newId();
  script = (step, turn) => {
    if (step === "shared") return [[write("src/config.ts")], [write("src/types.ts")], [done]][Math.min(turn, 2)]!;
    if (step.startsWith("helper")) {
      const own = step === "helper-1" ? "src/routes/menu.ts" : "src/routes/orders.ts";
      return [[write("src/app.ts")], [write("src/middleware/auth.ts")], [write(own)], [done], [stop]][Math.min(turn, 4)]!;
    }
    return [stop];
  };
  await runTeam("shubham", id);
  const dir = join(build, id, "backend");
  // The foundation's files exist and are as they were written, whatever the steps tried.
  expect(existsSync(join(dir, "src/config.ts"))).toBe(true);
  expect(existsSync(join(dir, "src/routes/auth.routes.ts"))).toBe(true);
  expect(foundationChanges(dir)).toEqual([]);
  // The shared step and each helper were told no when they tried.
  expect(answers.get("shared")![1]).toContain("not one of your files");
  expect(answers.get("helper-1")![1]).toContain("not one of your files");
  expect(answers.get("helper-1")![2]).toContain("not one of your files");
  // The helpers' own work is there, and they got to the lead.
  expect(existsSync(join(dir, "src/routes/menu.ts"))).toBe(true);
  expect(existsSync(join(dir, "src/routes/orders.ts"))).toBe(true);
  expect(turns.get("lead") ?? 0).toBeGreaterThan(0);
}, 120_000);

test("backend: a helper's first message holds its own work, not the other helpers' work or compiled files", async () => {
  const id = newId();
  const dir = join(build, id, "backend");
  mkdirSync(join(dir, "src/routes"), { recursive: true });
  mkdirSync(join(dir, "dist-test"), { recursive: true });
  writeFileSync(join(dir, "dist-test/old.js"), "COMPILED_OUTPUT");
  writeFileSync(join(dir, "src/routes/menu.ts"), "MENU_WORK");
  writeFileSync(join(dir, "src/routes/orders.ts"), "ORDER_WORK");
  // A report_blocked would stop the helpers before their first call, so the steps before the lead only finish.
  script = (step) => (step === "lead" ? [stop] : [done]);
  await runTeam("shubham", id);
  const helper = firstMessages.get("helper-1")!;
  expect(helper).toBeDefined();
  expect(helper).not.toContain("COMPILED_OUTPUT");
  const menuInFirst = helper.includes("MENU_WORK");
  const orderInFirst = helper.includes("ORDER_WORK");
  expect(menuInFirst !== orderInFirst).toBe(true);
}, 120_000);

test("backend: the lead's change to a tested file is put back, and the change made while running is handed back", async () => {
  const id = newId();
  const dir = join(build, id, "backend");
  // The lead's finish check, on what a builder left: the real exit check, on the real foundation.
  script = (step, turn) => {
    if (step === "shared") return [done];
    if (step.startsWith("helper")) return [[write(step === "helper-1" ? "src/routes/menu.ts" : "src/routes/orders.ts")], [done], [stop]][Math.min(turn, 2)]!;
    return [stop];
  };
  writeFileSync(join(build, "x"), "");
  await runTeam("shubham", id);
  writeFileSync(join(build, id, "build-plan.json"), JSON.stringify(plan(id)));
  writeFileSync(join(dir, "src/config.ts"), "changed by a command\n");
  writeFileSync(join(dir, "src/routes/menu.ts"), 'import { config } from "../config";\n(config as any).corsOrigin = "x";\n');
  const { backendExitChecks } = await import("../orchestrator/stages/builder-exit-checks.ts");
  const found = backendExitChecks(id).join("\n");
  expect(found).toContain("src/config.ts");
  expect(found).toContain("has been put back");
  expect(found).toContain("src/routes/menu.ts:2");
  expect(readFileSync(join(dir, "src/config.ts"), "utf-8")).toContain("Object.freeze");
}, 120_000);

test("frontend: the foundation is in the scaffold, and a helper is refused its files", async () => {
  const id = newId();
  const dir = join(build, id, "frontend");
  mkdirSync(dir, { recursive: true });
  aanya.writeStaticScaffold(plan(id) as never, dir);
  expect(existsSync(join(dir, "lib/http.ts"))).toBe(true);
  expect(existsSync(join(dir, "lib/session.ts"))).toBe(true);
  expect(foundationChanges(dir)).toEqual([]);
  script = (step, turn) => {
    if (step.startsWith("helper")) return [[write("lib/http.ts", "changed")], [write(step === "helper-1" ? "app/menu/page.tsx" : "app/order/page.tsx")], [done], [stop]][Math.min(turn, 3)]!;
    return [stop];
  };
  await runTeam("aanya", id);
  expect(answers.get("helper-1")![1]).toContain("not one of your files");
  expect(foundationChanges(dir)).toEqual([]);
  expect(existsSync(join(dir, "app/menu/page.tsx"))).toBe(true);
}, 120_000);
