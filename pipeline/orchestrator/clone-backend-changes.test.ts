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
