import { test, expect } from "bun:test";
import { AGENT_PROFILES, requiredSkills, assignBySkill, type TaskGroups } from "./capabilities.ts";
import type { GeneratorTask } from "./index.ts";

// Patent claim 1(a): dynamically assign tasks to specialised agents based on capability profiles.

const task = (description: string, outputFiles: string[], extra: Partial<GeneratorTask> = {}): GeneratorTask => ({ description, outputFiles, ...extra });
const groups = (g: Partial<TaskGroups>): TaskGroups => ({ shubham: [], aanya: [], pranav: [], ...g });

test("each generator has a profile with its own skills and the folders it works in", () => {
  expect(AGENT_PROFILES.map((p) => p.agent).sort()).toEqual(["aanya", "pranav", "shubham"]);
  for (const p of AGENT_PROFILES) {
    expect(p.skills.length).toBeGreaterThan(5);
    expect(p.domains.length).toBeGreaterThan(0);
  }
  const all = AGENT_PROFILES.flatMap((p) => p.skills);
  expect(new Set(all).size).toBe(all.length); // no skill belongs to two agents
});

test("requiredSkills reads the skills a task needs from its files and its description", () => {
  expect(requiredSkills(task("Add the invoices table", ["db/migrations/0002_invoices.sql"]))).toContain("database");
  expect(requiredSkills(task("Build the pricing page", ["frontend/app/pricing/page.tsx"]))).toContain("frontend");
  expect(requiredSkills(task("Add the invoice controller and route", ["backend/src/controllers/invoiceController.ts"]))).toContain("backend");
  expect(requiredSkills(task("Write a migration adding an index", []))).toContain("database");
});

test("a task whose files all belong to another agent's folder moves to that agent, and says why", () => {
  const r = assignBySkill(groups({ shubham: [task("Create the users table", ["db/migrations/0001_users.sql", "db/migrations/0002_sessions.sql"])] }));
  expect(r.groups.shubham).toEqual([]);
  expect(r.groups.pranav.map((t) => t.description)).toEqual(["Create the users table"]);
  const a = r.assignments[0]!;
  expect(a).toMatchObject({ from: "shubham", to: "pranav", moved: true });
  expect(a.reason).toContain("db/migrations");
});

test("a task that already sits with the right agent stays", () => {
  const r = assignBySkill(groups({ aanya: [task("Build the home page", ["frontend/app/page.tsx", "frontend/components/Hero.tsx"])] }));
  expect(r.groups.aanya.length).toBe(1);
  expect(r.assignments[0]).toMatchObject({ from: "aanya", to: "aanya", moved: false });
});

test("a task with files in its own agent's folder as well as another's is left where it is", () => {
  const r = assignBySkill(groups({ shubham: [task("Add the orders API and its table", ["backend/src/orders.ts", "db/migrations/0003_orders.sql", "db/migrations/0004_items.sql"])] }));
  expect(r.groups.shubham.length).toBe(1);
  expect(r.assignments[0]!.moved).toBe(false);
});

test("a task with no files moves only when its words clearly point at one other agent", () => {
  const clear = assignBySkill(groups({ shubham: [task("Write the migration and add a foreign key constraint to the table", [])] }));
  expect(clear.assignments[0]).toMatchObject({ to: "pranav", moved: true });
  const vague = assignBySkill(groups({ shubham: [task("Wire everything together and polish", [])] }));
  expect(vague.assignments[0]!.moved).toBe(false);
});

test("a task that is moved keeps its description, files, phase and size untouched", () => {
  const t = task("Create the users table", ["db/migrations/0001_users.sql"], { phase: 2, size: 5 });
  const r = assignBySkill(groups({ shubham: [t] }));
  expect(r.groups.pranav[0]).toEqual(t);
});

test("tasks that stay keep their order, and every task gets exactly one assignment record", () => {
  const a = task("A", ["backend/src/a.ts"]);
  const b = task("B table", ["db/migrations/1.sql"]);
  const c = task("C", ["backend/src/c.ts"]);
  const r = assignBySkill(groups({ shubham: [a, b, c] }));
  expect(r.groups.shubham.map((t) => t.description)).toEqual(["A", "C"]);
  expect(r.assignments.length).toBe(3);
});

test("an empty plan gives empty results", () => {
  const r = assignBySkill(groups({}));
  expect(r.assignments).toEqual([]);
  expect(r.groups).toEqual({ shubham: [], aanya: [], pranav: [] });
});
