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
import { extractNotApplied } from "./clone-report.ts";
import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { AGENT_MODELS, FALLBACK_CHAIN } from "@nexsidi/llm-client";
import { join } from "node:path";
import { resolveGeneratorRunner, type GeneratorRunner } from "../../packages/agent-runtime/src/generator-tier.ts";
import { missingColumns, schemaFromSql } from "./schema-check.ts";
import { verifyDir, type VerifyResult } from "./verify-commands.ts";

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
   path) you added, and whether you wrote a MIGRATION_REQUEST.sql.
8. When a change adds a field to data that is passed around (a type, an
   interface, a response shape), declare the new field as REQUIRED, not
   optional. The compiler then points at every place that builds that data,
   and you must fix each one: the controller that queries it, the code that
   formats it, the PDF or CSV that prints it. An optional field compiles
   cleanly while one of those places never passes it.
9. If part of the change refers to something that does not exist in this
   backend (an endpoint, a table, a feature the request assumes), do NOT
   build a new feature to match it and do NOT skip it quietly. Apply every
   part that can be applied, then end the task_complete summary with one
   line per part you could not apply, in exactly this form:
   "Not applied: <the part> — <why it cannot be applied here>".
10. A date the person picks on a form arrives as "YYYY-MM-DD", not as a full
   timestamp. Validate such a field so that "YYYY-MM-DD" is accepted (a
   regular expression for that shape, or a coercion that takes it). Do NOT
   use z.string().datetime() alone: it rejects "2026-10-31", and the screen
   that sends it would show "Invalid datetime".
11. A new endpoint answers in exactly the response shape the app's existing
   endpoints use: read an existing list controller and an existing single-item
   controller first and copy their shape (for a list, the rows themselves as
   the array — "data: [...]" — not wrapped in another object). End the
   task_complete summary with one line per new endpoint stating its exact
   response shape, for example "GET /plants/:id/tasks -> { success, data: Task[] }".`;

export function buildBackendEditTask(instructions: string): string {
  return `Apply exactly this backend change:
"${instructions}"

Start with list_files to see the current project structure, then read_file
on an existing file under src/routes/ to match its conventions before
adding anything new.`;
}

/**
 * Makes a migration safe to run again: ADD COLUMN / CREATE TABLE / CREATE INDEX get IF NOT EXISTS. An agent that
 * writes the same change twice then costs nothing, instead of stopping the database at start-up (Shopbill run 8).
 */
export function makeMigrationIdempotent(sql: string): string {
  return sql
    .replace(/\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS\b)/gi, "ADD COLUMN IF NOT EXISTS ")
    .replace(/\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\b)/gi, "CREATE TABLE IF NOT EXISTS ")
    .replace(/\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS\b|CONCURRENTLY\b)/gi, (_m, u) => `CREATE ${u ?? ""}INDEX IF NOT EXISTS `);
}

const normalizeSql = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim().toLowerCase();

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
  // The project the spend of every pass is added to (the same per-project total full builds use).
  projectId?: string;
}

export interface ApplyCloneBackendChangesResult {
  applied: boolean;
  summary: string;
  filesWritten: string[];
  errors: string[];
  migrationApplied: string | null; // the new migration's real filename, or null if none was requested
  // Parts of the change the pass reported it could not apply (see clone-report.ts).
  notApplied: string[];
}

export type BackendVerify = (backendDir: string) => Promise<VerifyResult>;

/** The same two checks the Docker build runs for the backend. */
export const verifyBackend: BackendVerify = (backendDir) =>
  verifyDir(backendDir, [
    { command: "npx tsc --noEmit", timeoutMs: 240_000 },
    { command: "npm run build", timeoutMs: 300_000 },
  ]);

type ApplyCloneBackendChangesCore = Omit<ApplyCloneBackendChangesResult, "notApplied">;

export async function applyCloneBackendChanges(
  opts: ApplyCloneBackendChangesOptions,
  deps: { runGenerator?: GeneratorRunner; verify?: BackendVerify } = {},
): Promise<ApplyCloneBackendChangesResult> {
  const core = await applyCloneBackendChangesCore(opts, deps);
  return { ...core, notApplied: extractNotApplied(core.summary) };
}

async function applyCloneBackendChangesCore(
  opts: ApplyCloneBackendChangesOptions,
  deps: { runGenerator?: GeneratorRunner; verify?: BackendVerify } = {},
): Promise<ApplyCloneBackendChangesCore> {
  const runGenerator = deps.runGenerator ?? resolveGeneratorRunner();
  const verify = deps.verify ?? verifyBackend;
  const backendDir = join(opts.buildDir, "backend");

  const runPass = (initialMessage: string, maxIterations: number) =>
    runGenerator({
      agentName: "shubham-clone-edit",
      // Same primary + fallback Shubham's own generator uses — this literally
      // IS his job (backend endpoints), just scoped to an existing app.
      model: AGENT_MODELS.shubham, // 2026-09-28: from llm-client's model registry (types.ts)
      fallbackModels: FALLBACK_CHAIN.shubham,
      apiKey: opts.apiKey,
      systemPrompt: CLONE_BACKEND_EDIT_SYSTEM_PROMPT,
      initialMessage,
      sandboxDir: backendDir,
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      geminiTier: "design",
      enableHttpTools: true,
      maxIterations,
      // Identical strings to Shubham's own real config — see agents/generators/
      // shubham/src/index.ts — not a new convention.
      requiredVerificationCommands: ["npx tsc --noEmit", "npm run build"],
    });

  const migrationsDir = join(opts.buildDir, "db", "migrations");
  const migrationRequestPath = join(backendDir, "MIGRATION_REQUEST.sql");
  let migrationApplied: string | null = null;

  // Moves the agent's hand-off file into db/migrations as the next numbered migration.
  const applyMigrationRequest = () => {
    if (!existsSync(migrationRequestPath)) return;
    const existingMigrations = existsSync(migrationsDir) ? readdirSync(migrationsDir) : [];
    const sql = makeMigrationIdempotent(readFileSync(migrationRequestPath, "utf-8"));
    unlinkSync(migrationRequestPath); // hand-off file — not real backend source, must not ship
    // A later pass can write the same change again; it must never become a second migration.
    const already = existingMigrations
      .filter((f) => f.endsWith(".sql"))
      .some((f) => normalizeSql(readFileSync(join(migrationsDir, f), "utf-8")) === normalizeSql(sql));
    if (already) return;
    const filename = nextMigrationFilename(existingMigrations, "clone_change");
    writeFileSync(join(migrationsDir, filename), sql, "utf-8");
    migrationApplied = migrationApplied ? `${migrationApplied}, ${filename}` : filename;
  };

  // Columns the code the agent wrote puts into the database that no migration creates.
  const missing = (filesWritten: string[]) => {
    const migrations = existsSync(migrationsDir)
      ? readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(join(migrationsDir, f), "utf-8"))
      : [];
    const schema = schemaFromSql(migrations);
    const found: { table: string; column: string; file: string }[] = [];
    for (const rel of filesWritten) {
      const abs = join(backendDir, rel);
      if (!/\.(ts|js)$/.test(rel) || !existsSync(abs)) continue;
      for (const m of missingColumns(readFileSync(abs, "utf-8"), schema)) found.push({ ...m, file: rel });
    }
    return found;
  };

  let result = await runPass(buildBackendEditTask(opts.instructions), 25);
  applyMigrationRequest();
  let passFilesWritten = result.filesWritten;

  // The pass ended without finishing (typically out of iterations, one step short — Shopbill run 6). Run its real
  // checks here. Failing: send it back once with exactly those errors. Passing: it just did not get to say so, so
  // continue it once with the original request. Either way the work it did is kept.
  if (!result.success) {
    const found = await verify(backendDir);
    if (found.ran) {
      const more = await runPass(
        found.ok
          ? `You did not finish this task. Compare what is already done with the request below, finish whatever is still ` +
              `missing (including MIGRATION_REQUEST.sql if the change needs a new column or table), run "npx tsc --noEmit" ` +
              `and "npm run build" until both pass, then call task_complete.\n\n${buildBackendEditTask(opts.instructions)}`
          : `The change was made, but the backend does not pass its checks. Fix exactly these errors and nothing else, ` +
              `then run "npx tsc --noEmit" and "npm run build" until both pass:\n\n${found.output}`,
        12,
      );
      applyMigrationRequest();
      passFilesWritten = [...new Set([...passFilesWritten, ...more.filesWritten])];
      if (more.success) {
        result = { ...result, success: true, summary: more.summary || result.summary, errors: [], iterations: result.iterations + more.iterations };
      } else {
        result = { ...result, errors: [...result.errors, ...more.errors], iterations: result.iterations + more.iterations };
      }
    }
  }

  // Types and the build cannot see a database column. If the code writes one no migration creates, send the
  // agent back once to write that migration — and fail the pass honestly if it still is not there.
  let filesWritten = passFilesWritten;
  let gaps = missing(filesWritten);
  if (gaps.length > 0) {
    const list = gaps.map((g) => `${g.table}.${g.column} (used in ${g.file})`).join(", ");
    const follow = await runPass(
      `Your change writes to database columns that no migration creates: ${list}.
` +
        `Write MIGRATION_REQUEST.sql now, at the root of this directory, with exactly the ALTER TABLE / CREATE TABLE statements these need ` +
        `(match the types already used for this project's tables). Do not change anything else.`,
      10,
    );
    applyMigrationRequest();
    filesWritten = [...filesWritten, ...follow.filesWritten];
    gaps = missing(passFilesWritten);
    result = { ...result, iterations: result.iterations + follow.iterations };
    if (gaps.length > 0) {
      const list2 = gaps.map((g) => `${g.table}.${g.column}`).join(", ");
      result = {
        ...result,
        success: false,
        errors: [...result.errors, `The code writes ${list2}, but no migration creates it, so it would fail at runtime.`],
      };
    }
  }

  return {
    applied: result.success,
    summary: result.summary,
    filesWritten,
    errors: result.errors,
    migrationApplied,
  };
}
