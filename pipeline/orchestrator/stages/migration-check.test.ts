import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationFindings } from "./migration-check.ts";

// 2026-10-24 (Brewline, found by starting a copy from scratch): a fix round added 0003_fix.sql, which uses MIN(id) on a
// uuid column. PostgreSQL 16 has no min(uuid), so on a new database the migration stops and Postgres never finishes
// starting: a customer's `docker compose up` fails. The running app had never been started from empty. The system now
// applies every migration, in order, to an empty PostgreSQL 16 before a builder may finish.

let dir = "";
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });

function project(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "mig-"));
  mkdirSync(join(dir, "db", "migrations"), { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, "db", "migrations", name), body);
  return dir;
}

function fakeDocker(failOn?: { file: string; message: string }) {
  const cmds: string[] = [];
  const exec = (cmd: string): string => {
    cmds.push(cmd);
    if (failOn && cmd.includes(`/m/${failOn.file}`)) throw Object.assign(new Error("Command failed"), { stderr: `psql:/m/${failOn.file}:15: ERROR:  ${failOn.message}\nLINE 2:     SELECT name, MIN(id) as keep_id\n` });
    return "";
  };
  return { cmds, exec };
}

test("every migration is applied in file order to an empty PostgreSQL 16, then the container is removed", async () => {
  const d = project({ "0001_b.sql": "SELECT 2;", "0000_a.sql": "SELECT 1;", "notes.txt": "x" });
  const f = fakeDocker();
  const r = await migrationFindings(d, { exec: f.exec, sleep: async () => {} });
  expect(r).toEqual({ ran: true, findings: [] });
  expect(f.cmds[0]).toContain("docker run -d");
  expect(f.cmds[0]).toContain("postgres:16");
  const applied = f.cmds.filter((c) => c.includes("psql")).map((c) => c.match(/\/m\/([^ "]+)/)![1]);
  expect(applied).toEqual(["0000_a.sql", "0001_b.sql"]);
  expect(f.cmds.every((c) => !c.includes("psql") || c.includes("ON_ERROR_STOP=1"))).toBe(true);
  expect(f.cmds[f.cmds.length - 1]).toContain("docker rm -f");
});

test("a migration that fails on a new database is reported with its file, line and the database's own message; later files are not run", async () => {
  const d = project({ "0000_a.sql": "SELECT 1;", "0003_fix.sql": "x", "0004_later.sql": "y" });
  const f = fakeDocker({ file: "0003_fix.sql", message: "function min(uuid) does not exist" });
  const r = await migrationFindings(d, { exec: f.exec, sleep: async () => {} });
  expect(r.ran).toBe(true);
  expect(r.findings.length).toBe(1);
  expect(r.findings[0]).toContain("db/migrations/0003_fix.sql");
  expect(r.findings[0]).toContain("function min(uuid) does not exist");
  expect(r.findings[0]).toContain("new database");
  expect(f.cmds.some((c) => c.includes("0004_later.sql"))).toBe(false);
  expect(f.cmds[f.cmds.length - 1]).toContain("docker rm -f"); // cleaned up after a failure too
});

test("no migrations, or docker not available, means not run, and says so", async () => {
  const none = await migrationFindings(project({}), { exec: () => "", sleep: async () => {} });
  expect(none.ran).toBe(false);
  const d = project({ "0000_a.sql": "SELECT 1;" });
  const noDocker = await migrationFindings(d, { exec: () => { throw new Error("docker: command not found"); }, sleep: async () => {} });
  expect(noDocker.ran).toBe(false);
  expect(noDocker.note).toContain("docker");
});

// 2026-10-25 (brewline3): the migrations are the database builder's files; a backend builder asked to fix them cannot, and the build
// stopped. The check now runs in the review round, where a db/ finding goes to the database builder.
test("the migration check runs in the review round, not in the backend builder's finish check", () => {
  const stage5 = readFileSync(new URL("./stage5-adversarial-qa.ts", import.meta.url), "utf-8");
  expect(stage5).toContain("backendFreshStartFindings");
  const shubham = readFileSync(new URL("../../../agents/generators/shubham/src/index.ts", import.meta.url), "utf-8");
  expect(shubham).not.toContain("backendFreshStartFindings");
});
