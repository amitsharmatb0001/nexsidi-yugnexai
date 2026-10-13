import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRunConfig, AgentRunResult } from "../../packages/agent-runtime/src/loop.ts";
import {
  applyCloneBackendChanges,
  buildBackendEditTask,
  nextMigrationFilename,
  CLONE_BACKEND_EDIT_SYSTEM_PROMPT,
} from "./clone-backend-changes.ts";

// ── buildBackendEditTask (pure) ───────────────────────────────────────────
test("buildBackendEditTask includes the exact backend instructions", () => {
  const task = buildBackendEditTask("add a wishlist table and endpoints");
  expect(task).toContain("add a wishlist table and endpoints");
});

// ── CLONE_BACKEND_EDIT_SYSTEM_PROMPT ──────────────────────────────────────
test("CLONE_BACKEND_EDIT_SYSTEM_PROMPT tells the agent how to hand off a migration it can't write directly", () => {
  expect(CLONE_BACKEND_EDIT_SYSTEM_PROMPT).toContain("MIGRATION_REQUEST.sql");
});

test("CLONE_BACKEND_EDIT_SYSTEM_PROMPT tells the agent to install dependencies first", () => {
  expect(CLONE_BACKEND_EDIT_SYSTEM_PROMPT).toContain("npm install");
});

// ── nextMigrationFilename (pure) ──────────────────────────────────────────
test("nextMigrationFilename continues the real sequential numbering convention", () => {
  expect(nextMigrationFilename(["0000_initial.sql", "0001_fix.sql", "0002_fix.sql"], "clone_change")).toBe("0003_clone_change.sql");
});

test("nextMigrationFilename starts at 0000 when there are no existing migrations", () => {
  expect(nextMigrationFilename([], "clone_change")).toBe("0000_clone_change.sql");
});

test("nextMigrationFilename ignores non-numbered files rather than crashing on them", () => {
  expect(nextMigrationFilename(["README.md", "0000_initial.sql"], "clone_change")).toBe("0001_clone_change.sql");
});

// ── applyCloneBackendChanges (real filesystem, fake injected runner) ─────
let tempBuildDir: string | null = null;
afterEach(() => {
  if (tempBuildDir) rmSync(tempBuildDir, { recursive: true, force: true });
  tempBuildDir = null;
});

function makeFixture(buildDir: string): void {
  mkdirSync(join(buildDir, "backend", "src", "routes"), { recursive: true });
  mkdirSync(join(buildDir, "db", "migrations"), { recursive: true });
  writeFileSync(join(buildDir, "db", "migrations", "0000_initial.sql"), "CREATE TABLE users (id uuid PRIMARY KEY);\n");
  writeFileSync(join(buildDir, "backend", "package.json"), JSON.stringify({ name: "backend" }));
}

test("applyCloneBackendChanges scopes the agent's sandboxDir to backend/ only — never the project root, never db/migrations/ directly", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-backend-test-"));
  makeFixture(tempBuildDir);

  let capturedConfig: AgentRunConfig | null = null;
  const runGenerator = async (config: AgentRunConfig) => {
    capturedConfig = config;
    return { success: true, summary: "done", filesWritten: [], iterations: 1, errors: [], escalated: false } satisfies AgentRunResult & { escalated: boolean };
  };

  await applyCloneBackendChanges(
    { buildDir: tempBuildDir, instructions: "add a wishlist endpoint", apiKey: "test-key" },
    { runGenerator },
  );

  expect(capturedConfig).not.toBeNull();
  expect(capturedConfig!.sandboxDir).toBe(join(tempBuildDir, "backend"));
});

test("applyCloneBackendChanges picks up a MIGRATION_REQUEST.sql the agent wrote and applies it as a real, sequentially-numbered migration", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-backend-test-"));
  makeFixture(tempBuildDir);

  const runGenerator = async (config: AgentRunConfig) => {
    // Simulate the real agent writing its migration request inside its own
    // sandboxDir (backend/) — exactly what the system prompt asks it to do,
    // since it has no direct access to db/migrations/ from there.
    writeFileSync(join(config.sandboxDir, "MIGRATION_REQUEST.sql"), "CREATE TABLE wishlist_items (id uuid PRIMARY KEY, user_id uuid NOT NULL);\n");
    return { success: true, summary: "added wishlist endpoints", filesWritten: ["src/routes/wishlist.routes.ts"], iterations: 5, errors: [], escalated: false };
  };

  const result = await applyCloneBackendChanges(
    { buildDir: tempBuildDir, instructions: "add a wishlist table and endpoints", apiKey: "test-key" },
    { runGenerator },
  );

  expect(result.applied).toBe(true);
  expect(result.migrationApplied).toBe("0001_clone_change.sql");

  const migrationPath = join(tempBuildDir, "db", "migrations", "0001_clone_change.sql");
  expect(existsSync(migrationPath)).toBe(true);
  expect(readFileSync(migrationPath, "utf-8")).toContain("CREATE TABLE wishlist_items");

  // Hand-off file must not linger inside backend/ once applied — it's not
  // meant to ship as part of the real backend source.
  expect(existsSync(join(tempBuildDir, "backend", "MIGRATION_REQUEST.sql"))).toBe(false);

  // The original migration must be completely untouched.
  expect(readdirSync(join(tempBuildDir, "db", "migrations")).sort()).toEqual(["0000_initial.sql", "0001_clone_change.sql"]);
});

test("applyCloneBackendChanges reports migrationApplied: null when no migration was requested — most backend changes won't need one", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-backend-test-"));
  makeFixture(tempBuildDir);

  const runGenerator = async () => ({
    success: true, summary: "added a GET endpoint using an existing table", filesWritten: ["src/routes/wishlist.routes.ts"], iterations: 3, errors: [], escalated: false,
  });

  const result = await applyCloneBackendChanges(
    { buildDir: tempBuildDir, instructions: "add a read-only endpoint", apiKey: "test-key" },
    { runGenerator },
  );

  expect(result.migrationApplied).toBeNull();
  expect(readdirSync(join(tempBuildDir, "db", "migrations"))).toEqual(["0000_initial.sql"]);
});

test("applyCloneBackendChanges reports applied:false and surfaces errors when the agent can't finish", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-backend-test-"));
  makeFixture(tempBuildDir);

  const runGenerator = async () => ({
    success: false, summary: "Max iterations reached", filesWritten: [], iterations: 25, errors: ["Max iterations exceeded"], escalated: true,
  });

  const result = await applyCloneBackendChanges(
    { buildDir: tempBuildDir, instructions: "add something complicated", apiKey: "test-key" },
    { runGenerator },
  );

  expect(result.applied).toBe(false);
  expect(result.errors).toContain("Max iterations exceeded");
});

// 2026-10-13 (Shopbill): code that writes a column no migration creates must not ship.
test("applyCloneBackendChanges sends the agent back once when its code uses a column no migration adds, and applies the migration it then writes", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-backend-test-"));
  makeFixture(tempBuildDir);
  writeFileSync(join(tempBuildDir, "db", "migrations", "0000_initial.sql"), "CREATE TABLE invoices (id uuid PRIMARY KEY, total bigint);\n");

  const messages: string[] = [];
  let call = 0;
  const runGenerator = async (config: AgentRunConfig) => {
    call += 1;
    messages.push(config.initialMessage);
    if (call === 1) {
      writeFileSync(join(config.sandboxDir, "src", "routes", "invoice.routes.ts"), "db.query(`INSERT INTO invoices (id, total, po_reference) VALUES ($1, $2, $3)`);\n");
      return { success: true, summary: "added po reference", filesWritten: ["src/routes/invoice.routes.ts"], iterations: 6, errors: [], escalated: false };
    }
    writeFileSync(join(config.sandboxDir, "MIGRATION_REQUEST.sql"), "ALTER TABLE invoices ADD COLUMN po_reference VARCHAR(50);\n");
    return { success: true, summary: "wrote the migration", filesWritten: ["MIGRATION_REQUEST.sql"], iterations: 2, errors: [], escalated: false };
  };

  const result = await applyCloneBackendChanges({ buildDir: tempBuildDir, instructions: "add a po reference to invoices", apiKey: "k" }, { runGenerator });

  expect(call).toBe(2);
  expect(messages[1]).toContain("po_reference");
  expect(result.applied).toBe(true);
  expect(result.migrationApplied).toBe("0001_clone_change.sql");
});

test("applyCloneBackendChanges fails the pass when the column is still missing after the one retry", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-backend-test-"));
  makeFixture(tempBuildDir);
  writeFileSync(join(tempBuildDir, "db", "migrations", "0000_initial.sql"), "CREATE TABLE invoices (id uuid PRIMARY KEY, total bigint);\n");

  let call = 0;
  const runGenerator = async (config: AgentRunConfig) => {
    call += 1;
    if (call === 1) writeFileSync(join(config.sandboxDir, "src", "routes", "invoice.routes.ts"), "db.query(`INSERT INTO invoices (id, total, po_reference) VALUES ($1, $2, $3)`);\n");
    return { success: true, summary: "done", filesWritten: call === 1 ? ["src/routes/invoice.routes.ts"] : [], iterations: 3, errors: [], escalated: false };
  };

  const result = await applyCloneBackendChanges({ buildDir: tempBuildDir, instructions: "add a po reference to invoices", apiKey: "k" }, { runGenerator });

  expect(call).toBe(2);
  expect(result.applied).toBe(false);
  expect(result.errors.join(" ")).toContain("po_reference");
});

test("applyCloneBackendChanges does not retry when nothing it wrote needs a new column", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-backend-test-"));
  makeFixture(tempBuildDir);
  writeFileSync(join(tempBuildDir, "db", "migrations", "0000_initial.sql"), "CREATE TABLE invoices (id uuid PRIMARY KEY, total bigint);\n");
  let call = 0;
  const runGenerator = async (config: AgentRunConfig) => {
    call += 1;
    writeFileSync(join(config.sandboxDir, "src", "routes", "invoice.routes.ts"), "db.query(`INSERT INTO invoices (id, total) VALUES ($1, $2)`);\n");
    return { success: true, summary: "done", filesWritten: ["src/routes/invoice.routes.ts"], iterations: 3, errors: [], escalated: false };
  };
  const result = await applyCloneBackendChanges({ buildDir: tempBuildDir, instructions: "tweak", apiKey: "k" }, { runGenerator });
  expect(call).toBe(1);
  expect(result.applied).toBe(true);
});

// 2026-10-13 (Shopbill run 6): the backend editor used all 25 iterations, stopped right after running its checks,
// and the build failed although it was one step from done.
test("applyCloneBackendChanges does not run a second pass when the first finished", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-backend-test-"));
  makeFixture(tempBuildDir);
  let call = 0;
  const runGenerator = async () => {
    call += 1;
    return { success: true, summary: "done", filesWritten: [], iterations: 5, errors: [], escalated: false };
  };
  const verify = async () => ({ ran: true, ok: true, output: "" });
  const r = await applyCloneBackendChanges({ buildDir: tempBuildDir, instructions: "x", apiKey: "k" }, { runGenerator, verify });
  expect(call).toBe(1);
  expect(r.applied).toBe(true);
});

test("applyCloneBackendChanges, when the pass ends with failing checks, sends the agent back once with exactly those errors", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-backend-test-"));
  makeFixture(tempBuildDir);
  const messages: string[] = [];
  let call = 0;
  const runGenerator = async (config: AgentRunConfig) => {
    call += 1;
    messages.push(config.initialMessage);
    return call === 1
      ? { success: false, summary: "ran out", filesWritten: ["src/a.ts"], iterations: 25, errors: ["ran out"], escalated: false }
      : { success: true, summary: "fixed", filesWritten: ["src/a.ts"], iterations: 3, errors: [], escalated: false };
  };
  const outputs = [{ ran: true, ok: false, output: "src/a.ts(3,1): error TS2304: Cannot find name 'x'" }, { ran: true, ok: true, output: "" }];
  const verify = async () => outputs.shift()!;
  const r = await applyCloneBackendChanges({ buildDir: tempBuildDir, instructions: "x", apiKey: "k" }, { runGenerator, verify });
  expect(call).toBe(2);
  expect(messages[1]).toContain("TS2304");
  expect(r.applied).toBe(true);
});

test("applyCloneBackendChanges, when the pass ends unfinished with green checks, continues it once with the original request", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-backend-test-"));
  makeFixture(tempBuildDir);
  const messages: string[] = [];
  let call = 0;
  const runGenerator = async (config: AgentRunConfig) => {
    call += 1;
    messages.push(config.initialMessage);
    return call === 1
      ? { success: false, summary: "ran out", filesWritten: ["src/a.ts"], iterations: 25, errors: ["ran out"], escalated: false }
      : { success: true, summary: "finished", filesWritten: ["src/b.ts"], iterations: 4, errors: [], escalated: false };
  };
  const verify = async () => ({ ran: true, ok: true, output: "" });
  const r = await applyCloneBackendChanges({ buildDir: tempBuildDir, instructions: "add a po reference to invoices", apiKey: "k" }, { runGenerator, verify });
  expect(call).toBe(2);
  expect(messages[1]).toContain("add a po reference to invoices");
  expect(r.applied).toBe(true);
  expect(r.filesWritten).toEqual(expect.arrayContaining(["src/a.ts", "src/b.ts"]));
});

test("applyCloneBackendChanges fails the pass when the continuation does not finish either", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-backend-test-"));
  makeFixture(tempBuildDir);
  const runGenerator = async () => ({ success: false, summary: "ran out", filesWritten: [], iterations: 25, errors: ["ran out"], escalated: false });
  const verify = async () => ({ ran: true, ok: true, output: "" });
  const r = await applyCloneBackendChanges({ buildDir: tempBuildDir, instructions: "x", apiKey: "k" }, { runGenerator, verify });
  expect(r.applied).toBe(false);
  expect(r.errors).toContain("ran out");
});

// 2026-10-13 (Shopbill run 7): the PDF generator gained an optional po_reference, but the code that builds its input
// never passed it, and the compiler could not object because the field was optional.
test("CLONE_BACKEND_EDIT_SYSTEM_PROMPT tells the agent to make a new field required on the type that carries it", () => {
  expect(CLONE_BACKEND_EDIT_SYSTEM_PROMPT.toLowerCase()).toContain("required");
  expect(CLONE_BACKEND_EDIT_SYSTEM_PROMPT.toLowerCase()).toContain("every place");
});
