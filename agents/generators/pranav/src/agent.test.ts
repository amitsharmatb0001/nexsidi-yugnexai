import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runFix, runChecked, pranavFixFiles, databaseExitChecks, getOutputDir } from "./index.ts";

// 2026-10-29 (team plan, stage 1): the database builder was one model call that could only write a new migration. In
// Brewline 3 it added order_items.name_at_time but could not update db/src/schema.ts, could not read the backend that
// uses the table, and never ran its migrations. It is now an agent in the database folder that reads the whole
// project, adds a new migration and keeps schema.ts in step, and cannot finish while they disagree or a migration
// fails on an empty database.
const PLAN = { projectId: "pdb1" } as never;
const prev = process.env.BUILD_DIR;
let dir = "";
afterEach(() => {
  process.env.BUILD_DIR = prev;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function setup(): { db: string; root: string } {
  dir = mkdtempSync(join(tmpdir(), "pranav-agent-"));
  process.env.BUILD_DIR = dir;
  const db = getOutputDir("pdb1");
  mkdirSync(join(db, "migrations"), { recursive: true });
  mkdirSync(join(db, "src"), { recursive: true });
  writeFileSync(join(db, "migrations", "0000_initial.sql"), 'CREATE TABLE "order_items" ("id" uuid PRIMARY KEY, "price_at_time" numeric(10,2) NOT NULL);\n');
  writeFileSync(join(db, "src", "schema.ts"), 'export const orderItems = pgTable("order_items", { id: uuid("id"), priceAtTime: numeric("price_at_time") });\n');
  return { db, root: resolve(db, "..") };
}

type Config = Record<string, unknown> & { writableFile: (p: string) => boolean; exitChecks: (s: string) => Promise<string[]> };
const fakeRunner = (seen: { config?: Config }, result: Record<string, unknown> = {}) =>
  (async (config: unknown) => {
    seen.config = config as Config;
    return { success: true, filesWritten: ["migrations/0001_fix.sql"], errors: [], escalations: [], escalated: false, ...result };
  }) as never;

test("the database fix runs as an agent in the database folder that reads the whole project", async () => {
  const { db, root } = setup();
  const seen: { config?: Config } = {};
  await runFix(PLAN, ["[INT1] past orders show today's item name"], { runAgent: fakeRunner(seen) });
  expect(seen.config!.agentName).toBe("pranav");
  expect(seen.config!.sandboxDir).toBe(db);
  expect(seen.config!.readOnlyDirs).toEqual([root]);
  expect(seen.config!.enableEscalation).toBe(true);
});

test("its task holds the findings, the real migrations word for word and the next migration's name", async () => {
  setup();
  const seen: { config?: Config } = {};
  await runFix(PLAN, ["[INT1] past orders show today's item name"], { runAgent: fakeRunner(seen) });
  const task = String(seen.config!.initialMessage);
  expect(task).toContain("past orders show today's item name");
  expect(task).toContain('CREATE TABLE "order_items"');
  expect(task).toContain("migrations/0001_fix.sql");
  expect(task).toContain("src/schema.ts");
});

test("it may add a new migration and change src/schema.ts, never an applied migration or any other file", () => {
  const files = pranavFixFiles(new Set(["migrations/0000_initial.sql"]));
  expect(files("migrations/0001_fix.sql")).toBe(true);
  expect(files("src/schema.ts")).toBe(true);
  expect(files("migrations/0000_initial.sql")).toBe(false);
  expect(files("package.json")).toBe(false);
  expect(files("migrations/notes.txt")).toBe(false);
});

test("the fix run is given exactly those files", async () => {
  setup();
  const seen: { config?: Config } = {};
  await runFix(PLAN, ["x"], { runAgent: fakeRunner(seen) });
  expect(seen.config!.writableFile("migrations/0000_initial.sql")).toBe(false);
  expect(seen.config!.writableFile("migrations/0001_fix.sql")).toBe(true);
});

test("it cannot finish while schema.ts misses a column a migration adds", async () => {
  const { db } = setup();
  writeFileSync(join(db, "migrations", "0001_fix.sql"), 'ALTER TABLE "order_items" ADD COLUMN "name_at_time" text NOT NULL DEFAULT \'\';\n');
  const out = await databaseExitChecks(resolve(db, ".."), { migrationCheck: async () => ({ ran: true, findings: [] }) });
  expect(out.join(" ")).toContain("name_at_time");
});

test("it cannot finish while a migration fails on an empty database", async () => {
  const { db } = setup();
  const out = await databaseExitChecks(resolve(db, ".."), {
    migrationCheck: async () => ({ ran: true, findings: ["db/migrations/0001_fix.sql fails on a new database: column already exists"] }),
  });
  expect(out).toEqual(["db/migrations/0001_fix.sql fails on a new database: column already exists"]);
});

test("a migration check that could not run does not block the finish", async () => {
  const { db } = setup();
  const out = await databaseExitChecks(resolve(db, ".."), { migrationCheck: async () => ({ ran: false, findings: [], note: "migration check not run: docker" }) });
  expect(out).toEqual([]);
});

test("the fix run's finish check is that check", async () => {
  const { db } = setup();
  writeFileSync(join(db, "migrations", "0001_fix.sql"), 'ALTER TABLE "order_items" ADD COLUMN "name_at_time" text;\n');
  const seen: { config?: Config } = {};
  await runFix(PLAN, ["x"], { runAgent: fakeRunner(seen), migrationCheck: async () => ({ ran: true, findings: [] }) });
  expect((await seen.config!.exitChecks("done")).join(" ")).toContain("name_at_time");
});

test("the agent's result comes back with its hand-ons", async () => {
  setup();
  const escalations = [{ targetAgent: "shubham", finding: "orders.ts never writes name_at_time" }];
  const r = await runFix(PLAN, ["x"], { runAgent: fakeRunner({}, { escalations }) });
  expect(r.success).toBe(true);
  expect(r.filesWritten).toEqual(["migrations/0001_fix.sql"]);
  expect(r.escalations).toEqual(escalations as never);
});

// ── the first build: check right away, and fix what the check finds ─────────────

test("after the first build the database is checked, and what fails goes to the agent at once", async () => {
  setup();
  const fixed: string[][] = [];
  await runChecked(PLAN, {
    run: async () => ({ success: true, projectId: "pdb1", outputDir: "", filesWritten: ["src/schema.ts"], errors: [] }),
    checks: async () => ["db/migrations/0000_initial.sql fails on a new database: syntax error"],
    fix: async (_p, f) => {
      fixed.push(f);
      return { success: true, projectId: "pdb1", outputDir: "", filesWritten: ["migrations/0001_fix.sql"], errors: [] };
    },
  });
  expect(fixed).toEqual([["db/migrations/0000_initial.sql fails on a new database: syntax error"]]);
});

test("a first build that passes its checks is not sent to the agent", async () => {
  setup();
  let fixCalls = 0;
  const r = await runChecked(PLAN, {
    run: async () => ({ success: true, projectId: "pdb1", outputDir: "", filesWritten: ["src/schema.ts"], errors: [] }),
    checks: async () => [],
    fix: async () => {
      fixCalls++;
      return { success: true, projectId: "pdb1", outputDir: "", filesWritten: [], errors: [] };
    },
  });
  expect(fixCalls).toBe(0);
  expect(r.filesWritten).toEqual(["src/schema.ts"]);
});

test("the build step runs the checked database build", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const acts = readFileSync(new URL("../../../../pipeline/activities/index.ts", import.meta.url), "utf-8");
  expect(acts).toContain('import { runChecked as runPranavAgent }  from "../../agents/generators/pranav/src/index.ts";');
});
