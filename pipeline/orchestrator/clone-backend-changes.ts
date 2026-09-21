// Backend-editing counterpart to clone-changes.ts (2026-09-02, real user
// request: "fix system to deal with this — see what they have, what has to
// be built extra or removed, then build properly"). Only invoked when
// clone-plan.ts's planCloneChanges() decides the request genuinely needs
// backend/DB work — a request that stays inside the frontend never reaches
// this file at all.
//
// sandboxDir is scoped to backend/ ONLY — deliberately mirroring Shubham's
// own real generator (agents/generators/shubham/src/index.ts) exactly, same
// model, same requiredVerificationCommands, same tight scope. This is a
// point-for-point copy of an already-proven-safe pattern, not a new
// boundary: loop.ts's file tools hard-reject any path that resolves outside
// sandboxDir (`abs.startsWith(resolve(sandboxDir))`), so this agent
// physically cannot read or write frontend/ or db/migrations/, whatever its
// prompt says.
//
// Migrations are the one real gap that tight scope creates: db/migrations/
// is a SIBLING of backend/, not a child of it, so a schema change can't be
// written directly from here. The fix is a deterministic hand-off, not a
// wider sandbox: the agent writes the raw SQL to backend/MIGRATION_REQUEST.sql
// (a file inside its own sandbox), and this module — real code, no LLM
// judgment — moves that content into a properly-numbered file under
// db/migrations/ after the agent run completes, then deletes the hand-off
// file. The agent's write access never actually widens.
import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { resolveGeneratorRunner, type GeneratorRunner } from "../../packages/agent-runtime/src/generator-tier.ts";

export const CLONE_BACKEND_EDIT_SYSTEM_PROMPT = `You are editing an ALREADY WORKING, ALREADY DELIVERED Express + TypeScript backend.
This is NOT a fresh build — it already compiles and its existing endpoints already work. Your ONLY job is to add exactly what's requested below, without breaking anything that already works.

RULES:
1. This directory has no node_modules yet — dependencies were intentionally
   not copied from the source project. Run "npm install" FIRST, before
   anything else.
2. Add new routes as a new file under src/routes/<resource>.routes.ts,
   following the exact pattern of an existing route file in that
   directory. If the request below names a specific existing file as a
   pattern to model after, read_file that EXACT file FIRST — it was named
   because it already solves the same kind of problem, so copying its real
   conventions (error handling, response shape, auth middleware usage)
   beats writing your own from scratch or searching for a different one.
3. Wire your new route file into src/routes/index.ts the same way the
   existing ones are already wired — do not restructure how existing
   routes are mounted, do not touch an existing route file's own behavior.
4. If this change needs a NEW database table or a new column: you do NOT
   have direct access to the migrations directory from here — it is
   outside this sandbox on purpose. Instead, write the exact SQL
   statement(s) needed (CREATE TABLE / ALTER TABLE, following the naming
   and column-type conventions already used by this project's existing
   tables) to a file named exactly "MIGRATION_REQUEST.sql" at the root of
   this directory. A separate, deterministic step applies it as a real,
   sequentially-numbered migration after you finish — do not attempt to
   write directly to any migrations folder, and do not invent one inside
   this directory.
5. Never modify an existing migration file's content — only ever request a
   NEW one via MIGRATION_REQUEST.sql, never edit history.
6. After editing, run "npx tsc --noEmit" then "npm run build" to verify
   nothing broke. Do not call task_complete until both pass.
7. Call task_complete with a summary listing every new endpoint (method +
   path) you added, and whether you wrote a MIGRATION_REQUEST.sql.`;

export function buildBackendEditTask(instructions: string): string {
  return `Apply exactly this backend change:
"${instructions}"

Start with list_files to see the current project structure, then read_file
on an existing file under src/routes/ to match its conventions before
adding anything new.`;
}

// Continues this project's own real numbering convention (0000_initial.sql,
// 0001_fix.sql, ... — confirmed live against a real generated project's
// db/migrations/ directory) rather than inventing a different scheme.
// Exported for direct unit testing.
export function nextMigrationFilename(existingFiles: string[], slug: string): string {
  const numbers = existingFiles
    .map((f) => f.match(/^(\d+)_/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => Number(m[1]));
  const next = numbers.length > 0 ? Math.max(...numbers) + 1 : 0;
  return `${String(next).padStart(4, "0")}_${slug}.sql`;
}

export interface ApplyCloneBackendChangesOptions {
  buildDir: string; // clone root — backend/ and db/migrations/ are both children of this
  instructions: string;
  apiKey: string;
}

export interface ApplyCloneBackendChangesResult {
  applied: boolean;
  summary: string;
  filesWritten: string[];
  errors: string[];
  migrationApplied: string | null; // the new migration's real filename, or null if none was requested
}

export async function applyCloneBackendChanges(
  opts: ApplyCloneBackendChangesOptions,
  deps: { runGenerator?: GeneratorRunner } = {},
): Promise<ApplyCloneBackendChangesResult> {
  const runGenerator = deps.runGenerator ?? resolveGeneratorRunner();
  const backendDir = join(opts.buildDir, "backend");

  const result = await runGenerator({
    agentName: "shubham-clone-edit",
    // Same primary + fallback Shubham's own generator uses — this literally
    // IS his job (backend endpoints), just scoped to an existing app.
    model: "mistralai/mistral-medium-3.5-128b",
    fallbackModels: ["qwen/qwen3-next-80b-a3b-instruct"],
    apiKey: opts.apiKey,
    systemPrompt: CLONE_BACKEND_EDIT_SYSTEM_PROMPT,
    initialMessage: buildBackendEditTask(opts.instructions),
    sandboxDir: backendDir,
    geminiTier: "design",
    enableHttpTools: true,
    maxIterations: 25,
    // Identical strings to Shubham's own real config — see agents/generators/
    // shubham/src/index.ts — not a new convention.
    requiredVerificationCommands: ["npx tsc --noEmit", "npm run build"],
  });

  let migrationApplied: string | null = null;
  const migrationRequestPath = join(backendDir, "MIGRATION_REQUEST.sql");
  if (existsSync(migrationRequestPath)) {
    const migrationsDir = join(opts.buildDir, "db", "migrations");
    const existingMigrations = existsSync(migrationsDir) ? readdirSync(migrationsDir) : [];
    const filename = nextMigrationFilename(existingMigrations, "clone_change");
    const sql = readFileSync(migrationRequestPath, "utf-8");
    writeFileSync(join(migrationsDir, filename), sql, "utf-8");
    unlinkSync(migrationRequestPath); // hand-off file — not real backend source, must not ship
    migrationApplied = filename;
  }

  return {
    applied: result.success,
    summary: result.summary,
    filesWritten: result.filesWritten,
    errors: result.errors,
    migrationApplied,
  };
}
