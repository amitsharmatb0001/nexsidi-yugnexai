// Pranav — Drizzle ORM migrations generator
// Produces complete Drizzle schema + migration SQL from a BuildPlan DB schema.
// Uses Qwen2.5-Coder 7B via local Ollama (GPU on Dell G15).

import { agentChat, AGENT_MODELS, FALLBACK_CHAIN } from "@nexsidi/llm-client";
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import type { BuildPlan, DrizzleTable, DrizzleColumn } from "../../../arjun/src/index.ts";
import type { GeneratorResult } from "../../shubham/src/index.ts";
import { resolveGeneratorRunner, type GeneratorRunner } from "../../../../packages/agent-runtime/src/generator-tier.ts";
import type { AgentRunConfig } from "../../../../packages/agent-runtime/src/loop.ts";
import type { WritableFile } from "../../../../packages/agent-runtime/src/ownership.ts";
import type { MigrationCheckResult } from "../../../../pipeline/orchestrator/stages/migration-check.ts";
import { buildDirFor } from "../../../../packages/agent-runtime/src/build-dir.ts";
import { answersBlock } from "../../../../packages/agent-runtime/src/tools/ask.ts";

// ── Main entry ────────────────────────────────────────────────────────────────
export async function run(plan: BuildPlan): Promise<GeneratorResult> {
  const outputDir = getOutputDir(plan.projectId);
  const filesWritten: string[] = [];
  const errors: string[] = [];

  try {
    // Generate Drizzle schema TypeScript from the DB schema spec
    const schemaContent = generateDrizzleSchema(plan.dbSchema.tables);
    const schemaPath = join(outputDir, "src/schema.ts");
    mkdirSync(dirname(schemaPath), { recursive: true });
    writeFileSync(schemaPath, schemaContent, "utf-8");
    filesWritten.push("src/schema.ts");

    // Generate initial SQL migration from schema
    const migrationSql = await generateMigrationSql(plan, schemaContent);
    const migrationPath = join(outputDir, "migrations/0000_initial.sql");
    mkdirSync(dirname(migrationPath), { recursive: true });
    writeFileSync(migrationPath, migrationSql, "utf-8");
    filesWritten.push("migrations/0000_initial.sql");
    // 2026-10-25: order history survives a deleted catalog row — the system rewrites a line table's catalog reference to RESTRICT.
    const { keepHistoryInMigrations } = await import("../../../../pipeline/orchestrator/stages/builder-exit-checks.ts");
    for (const change of keepHistoryInMigrations(dirname(outputDir))) console.log(`[pranav] history kept by the system: ${change}`);

    // Static config files
    for (const { path: relPath, content } of buildStaticFiles(plan)) {
      const absPath = join(outputDir, relPath);
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, content, "utf-8");
      filesWritten.push(relPath);
    }
  } catch (err) {
    errors.push(String(err));
  }

  return { success: errors.length === 0, projectId: plan.projectId, outputDir, filesWritten, errors };
}

// 2026-10-29 (team plan, stage 1): the database fix is an agent in the database folder. It was one model call that could
// only write a new migration: in Brewline 3 it added order_items.name_at_time but could not update src/schema.ts, read the
// backend that uses the table, or run its migrations. Now it reads the whole project, adds a NEW migration (an applied
// one is never edited — CLAUDE.md D8, expand-contract) and keeps src/schema.ts in step, and it cannot finish while the
// two disagree or a migration fails on an empty PostgreSQL 16.
export interface PranavAgentDeps {
  runAgent?: GeneratorRunner;
  migrationCheck?: (projectDir: string) => Promise<MigrationCheckResult>;
}

/** The files a fix may write: a new numbered migration and src/schema.ts. */
export function pranavFixFiles(appliedMigrations: Set<string>): WritableFile {
  return (relPath) => {
    const p = relPath.replace(/\\/g, "/");
    if (p === "src/schema.ts") return true;
    return /^migrations\/\d{4}_[\w-]+\.sql$/.test(p) && !appliedMigrations.has(p);
  };
}

/** The database builder's finish check: src/schema.ts lists every column the migrations add, and every migration runs on an empty database. */
export async function databaseExitChecks(projectDir: string, deps: Pick<PranavAgentDeps, "migrationCheck"> = {}): Promise<string[]> {
  const { schemaMigrationSyncFindings } = await import("../../../../pipeline/orchestrator/stages/shipping-hygiene.ts");
  const { migrationFindings } = await import("../../../../pipeline/orchestrator/stages/migration-check.ts");
  const sync = schemaMigrationSyncFindings(projectDir);
  const migrations = await (deps.migrationCheck ?? migrationFindings)(projectDir);
  if (!migrations.ran && migrations.note) console.log(`[pranav] ${migrations.note}`);
  return [...sync, ...migrations.findings];
}

export function buildPranavFixTask(findings: string[], plan: BuildPlan): string {
  const outputDir = getOutputDir(plan.projectId);
  const migrationsDir = join(outputDir, "migrations");
  const next = `migrations/${nextMigrationFilename(migrationsDir, "fix")}`;
  return `Fix these findings in the database.

FINDINGS:
${findings.map((f, i) => `${i + 1}. ${f}`).join("\n")}

THE MIGRATIONS THAT RUN, word for word (already applied — never edit them):
${readMigrations(migrationsDir) || "(none)"}

src/schema.ts (it must list every table and column the migrations create):
${readExistingSchema(outputDir) || "(missing)"}

HOW:
1. Check each finding against the migrations above and against the code that uses the tables: read ../backend with
   read_file, read_files or grep.
2. If the database must change: write ONE new migration, ${next}, with ALTER TABLE / CREATE INDEX / ADD CONSTRAINT
   statements (expand only: no DROP, no rename), and add every new column to src/schema.ts.
3. If the migrations already do what a finding asks: call dispute_finding with the statement that shows it.
4. If the fix belongs in the backend or the frontend code: call escalate_finding with the owner (shubham for the
   backend, aanya for the frontend), the file and what must change there.
5. Call task_complete. The system then checks that src/schema.ts matches the migrations and that every migration runs
   on an empty PostgreSQL 16; you cannot finish until both hold.` + answersBlock(plan.projectId);
}

export async function runFix(plan: BuildPlan, findings: string[], deps: PranavAgentDeps = {}): Promise<GeneratorResult> {
  const outputDir = getOutputDir(plan.projectId);
  const migrationsDir = join(outputDir, "migrations");
  const projectDir = resolve(outputDir, "..");
  const applied = new Set(existsSync(migrationsDir) ? readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).map((f) => `migrations/${f}`) : []);
  const runner = deps.runAgent ?? resolveGeneratorRunner();
  const result = await runner({
    agentName: "pranav",
    model: AGENT_MODELS.pranav,
    fallbackModels: FALLBACK_CHAIN.pranav,
    apiKey: process.env.NIM_API_KEY ?? "",
    systemPrompt: "",
    initialMessage: buildPranavFixTask(findings, plan),
    sandboxDir: outputDir,
    readOnlyDirs: [projectDir],
    enableAsk: true,
    projectId: plan.projectId,
    geminiTier: "generation",
    enableEscalation: true,
    writableFile: pranavFixFiles(applied),
    maxIterations: 30,
    exitChecks: () => databaseExitChecks(projectDir, deps),
  } as AgentRunConfig);
  return {
    success: result.success,
    projectId: plan.projectId,
    outputDir,
    filesWritten: result.filesWritten,
    errors: result.errors,
    escalations: result.escalations,
  };
}

/** The first build, then the same checks at once; what they find goes to the agent before anyone reviews the app. */
export async function runChecked(
  plan: BuildPlan,
  deps: {
    run?: (plan: BuildPlan) => Promise<GeneratorResult>;
    checks?: (projectDir: string) => Promise<string[]>;
    fix?: (plan: BuildPlan, findings: string[]) => Promise<GeneratorResult>;
  } = {},
): Promise<GeneratorResult> {
  const first = await (deps.run ?? run)(plan);
  if (!first.success) return first;
  const projectDir = resolve(getOutputDir(plan.projectId), "..");
  const problems = await (deps.checks ?? ((d: string) => databaseExitChecks(d)))(projectDir);
  if (problems.length === 0) return first;
  console.log(`[pranav] the first build's checks found ${problems.length} problem(s); the database builder fixes them now`);
  const fixed = await (deps.fix ?? ((p: BuildPlan, f: string[]) => runFix(p, f)))(plan, problems);
  return {
    ...first,
    success: fixed.success,
    filesWritten: [...first.filesWritten, ...fixed.filesWritten.filter((f) => !first.filesWritten.includes(f))],
    errors: [...first.errors, ...fixed.errors],
    escalations: fixed.escalations,
  };
}

/** Every migration's SQL, in order, each under its file name. */
function readMigrations(migrationsDir: string): string {
  if (!existsSync(migrationsDir)) return "";
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => `-- ${f}\n${readFileSync(join(migrationsDir, f), "utf-8")}`)
    .join("\n");
}

function readExistingSchema(outputDir: string): string {
  const schemaPath = join(outputDir, "src/schema.ts");
  return existsSync(schemaPath) ? readFileSync(schemaPath, "utf-8") : "";
}

// Exported for direct testing — picks the next zero-padded 4-digit
// migration number by scanning the migrations dir, matching Drizzle's own
// NNNN_name.sql convention (0000_initial.sql is always Pranav's first
// write). A missing/empty migrations dir starts at 0001 (0000 is always
// the initial migration, even if this is somehow called before run()).
export function nextMigrationFilename(migrationsDir: string, label: string): string {
  let maxNum = 0;
  if (existsSync(migrationsDir)) {
    for (const f of readdirSync(migrationsDir)) {
      const m = f.match(/^(\d{4})_/);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1]!, 10));
    }
  }
  const next = String(maxNum + 1).padStart(4, "0");
  return `${next}_${label}.sql`;
}

function normalizeColumn(col: any): DrizzleColumn {
  const name = col.name;
  let drizzleType = col.drizzleType || col.type || "text";
  
  if (typeof drizzleType === "string") {
    drizzleType = drizzleType.trim();
    if (!drizzleType.includes("(") && !drizzleType.includes(")")) {
      if (drizzleType === "uuid" || drizzleType === "timestamp") {
        drizzleType = `${drizzleType}()`;
      } else if (drizzleType === "text" || drizzleType === "integer" || drizzleType === "boolean" || drizzleType === "date") {
        drizzleType = `${drizzleType}()`;
      } else {
        drizzleType = `${drizzleType}()`;
      }
    }
  } else {
    drizzleType = "text()";
  }

  const constraints: string[] = Array.isArray(col.constraints) ? [...col.constraints] : [];
  
  if (col.primaryKey) {
    if (!constraints.includes(".primaryKey()")) {
      constraints.push(".primaryKey()");
    }
  }
  if (col.nullable === false) {
    if (!constraints.includes(".notNull()")) {
      constraints.push(".notNull()");
    }
  }
  if (col.unique) {
    if (!constraints.includes(".unique()")) {
      constraints.push(".unique()");
    }
  }
  if (col.default !== undefined) {
    const defStr = String(col.default);
    let normalizedDefault = "";
    if (defStr.startsWith("sql`") || defStr.startsWith("sql(")) {
      normalizedDefault = `.default(${defStr})`;
    } else if (defStr.includes("now()") || defStr.includes("uuid") || defStr.includes("random")) {
      normalizedDefault = `.default(sql\`${defStr}\`)`;
    } else {
      normalizedDefault = `.default(${defStr})`;
    }
    if (!constraints.some(c => c.startsWith(".default("))) {
      constraints.push(normalizedDefault);
    }
  }

  return {
    name,
    drizzleType,
    constraints,
    references: col.references,
  };
}

function renderIndex(idx: any, tableName: string): string {
  if (typeof idx === "string") return idx;
  if (idx && typeof idx === "object") {
    const name = idx.name || `${tableName}_idx`;
    const columns = Array.isArray(idx.columns) ? idx.columns : [];
    if (columns.length > 0) {
      const camelName = snakeToCamel(name);
      const colsStr = columns.map((c: string) => `table.${c}`).join(", ");
      return `${camelName}: index("${name}").on(${colsStr})`;
    }
  }
  return "";
}

// ── Deterministic Drizzle schema generation (no LLM needed for structure) ────
// Arjun already spec'd the columns with drizzleType + constraints — just render it.
// 2026-08-18: real bug found live (RateGate) — Arjun's dbSchema-generation
// call is LLM-authored JSON with no strict structured-output schema
// enforcement, so it non-deterministically emitted `fields` (with per-field
// `type`/`nullable`/`primaryKey`/`default`) instead of the documented
// `columns` (DrizzleColumn[]) shape for this run — crashing here with
// "TypeError: undefined is not an object (evaluating 't.columns.map')" and
// killing the whole generation stage. normalizeColumn (below) already
// handles BOTH per-column shapes correctly (col.drizzleType || col.type,
// col.nullable, col.primaryKey, col.default) — the only actually broken
// part was this outer table-level property name. Falling back to t.fields
// when t.columns is absent closes the crash without needing to chase down
// and constrain Arjun's own prompt/schema enforcement under time pressure.
export function generateDrizzleSchema(tables: DrizzleTable[]): string {
  const normalizedTables = tables.map((t) => ({
    ...t,
    // 2026-08-22: same root cause as the columns/fields fallback above —
    // Arjun's dbSchema JSON is unconstrained LLM output and this run used
    // `tableName` instead of the documented `name` key, so every table.name
    // read below (snakeToCamel(table.name), etc.) was undefined and crashed
    // on `undefined.replace(...)` inside snakeToCamel. Confirmed live
    // against this project's actual db-schema.json on disk.
    name: t.name ?? (t as unknown as { tableName?: string }).tableName ?? "",
    columns: (t.columns ?? (t as unknown as { fields?: unknown[] }).fields ?? []).map(normalizeColumn),
  }));

  const hasIndexes = normalizedTables.some(t => t.indexes && t.indexes.length > 0);

  const imports = new Set<string>([
    "pgTable", "sql", "relations",
    ...(hasIndexes ? ["index"] : []),
    // collect all drizzle types used
    ...normalizedTables.flatMap((t) =>
      t.columns.map((c) => c.drizzleType.replace(/\(.*\)/, ""))
    ),
  ]);

  const importLine = `import { ${[...imports].sort().join(", ")} } from "drizzle-orm/pg-core";\n`;

  const tableBlocks = normalizedTables.map((table) => {
    const cols = table.columns.map((col) => renderColumn(col)).join(",\n  ");
    const renderedIndexes = (table.indexes || [])
      .map(idx => renderIndex(idx, table.name))
      .filter(Boolean);

    const indexBlock =
      renderedIndexes.length > 0
        ? `, (table) => ({\n  ${renderedIndexes.join(",\n  ")}\n})`
        : "";
    return `export const ${snakeToCamel(table.name)} = pgTable("${table.name}", {\n  ${cols}\n}${indexBlock});`;
  });

  // Relations block — infer from FK references
  const relationBlocks = normalizedTables
    .map((table) => buildRelationsBlock(table, normalizedTables))
    .filter(Boolean);

  return [importLine, ...tableBlocks, ...relationBlocks].join("\n\n");
}

// 2026-08-23: real bug found live (project a355bbb5fa35) — Arjun's dbSchema
// JSON is unconstrained LLM output (same root cause class as the tableName/
// name fallback above) and this run wrote a FK reference as SQL syntax,
// "users(id)", instead of the documented dot notation "users.id". Splitting
// "users(id)" on "." finds no dot at all, so refTable came out as the whole
// literal string "users(id)" — producing `.references(() => users(id).id)`,
// invalid TypeScript (calling a pgTable object, not a function) that crashed
// on import exactly like the earlier bug. Normalizes both shapes so either
// one Arjun happens to emit resolves to the real { table, column } pair.
function normalizeReference(ref: string): { table: string; column: string } {
  const paren = ref.match(/^(\w+)\((\w+)\)$/);
  if (paren) return { table: paren[1]!, column: paren[2]! };
  const [table, column] = ref.split(".");
  return { table: table ?? ref, column: column ?? "id" };
}

function renderColumn(col: DrizzleColumn): string {
  const constraints = col.constraints.join("");
  const ref = col.references
    ? (() => {
        const { table, column } = normalizeReference(col.references!);
        return `.references(() => ${snakeToCamel(table)}.${column})`;
      })()
    : "";
  // normalizeColumn always leaves drizzleType ending in "()" (either freshly
  // appended for a bare type name, or already present from the documented
  // shape) — the column name is the type function's OWN argument, e.g.
  // `uuid("id")`, not a second call appended after it (`uuid()("id")`).
  const typeCall = col.drizzleType.replace(/\(\)$/, `("${col.name}")`);
  return `${col.name}: ${typeCall}${constraints}${ref}`;
}

function buildRelationsBlock(table: DrizzleTable, allTables: DrizzleTable[]): string {
  const fkCols = table.columns.filter((c) => c.references);
  if (fkCols.length === 0) return "";

  const relName = snakeToCamel(table.name);
  const relLines = fkCols.map((col) => {
    const { table: refTable } = normalizeReference(col.references!);
    const refName = snakeToCamel(refTable);
    const fieldName = col.name.replace(/_id$/, "");
    return `  ${fieldName}: one(${refName}, { fields: [${relName}.${col.name}], references: [${refName}.id] })`;
  });

  const isChildOf = (c: DrizzleColumn) => c.references && normalizeReference(c.references).table === table.name;
  const hasChildren = allTables.some((t) => t.columns.some(isChildOf));
  if (hasChildren) {
    const childRels = allTables
      .filter((t) => t.columns.some(isChildOf))
      .map((t) => `  ${t.name}: many(${snakeToCamel(t.name)})`);
    relLines.push(...childRels);
  }

  return `export const ${relName}Relations = relations(${relName}, ({ one, many }) => ({\n${relLines.join(",\n")}\n}));`;
}

// ── LLM call for initial SQL migration ───────────────────────────────────────
async function generateMigrationSql(plan: BuildPlan, schema: string): Promise<string> {
  const { content } = await agentChat(
    "pranav",
    [
      { role: "system", content: PRANAV_MIGRATION_PROMPT },
      {
        role: "user",
        content: `Generate the initial PostgreSQL migration SQL for this Drizzle schema:\n\n${schema}`,
      },
    ],
    process.env.NIM_API_KEY ?? "",
  );

  // Extract SQL from code block or raw
  const sqlMatch = content.match(/```sql\s*([\s\S]*?)\s*```/) ?? content.match(/```\s*([\s\S]*?)\s*```/);
  return sqlMatch?.[1]?.trim() ?? content.trim();
}

// ── Static config files ───────────────────────────────────────────────────────
function buildStaticFiles(plan: BuildPlan): Array<{ path: string; content: string }> {
  return [
    {
      path: "package.json",
      content: JSON.stringify(
        {
          name: `project-${plan.projectId}-db`,
          version: "1.0.0",
          private: true,
          scripts: {
            generate: "drizzle-kit generate",
            migrate:  "drizzle-kit migrate",
            studio:   "drizzle-kit studio",
          },
          dependencies: {
            "drizzle-orm":  "^0.32.0",
            "drizzle-kit":  "^0.23.0",
            pg:             "^8.12.0",
            "@types/pg":    "^8.11.6",
            dotenv:         "^16.4.5",
          },
        },
        null, 2,
      ),
    },
    {
      path: "drizzle.config.ts",
      content: `import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  schema: "./src/schema.ts",
  out:    "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
`,
    },
    {
      path: ".env.example",
      content: "DATABASE_URL=postgresql://user:pass@postgres:5432/appdb\n",
    },
  ];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function getOutputDir(projectId: string): string {
  return join(buildDirFor(projectId), "db");
}

// ── Migration system prompt ───────────────────────────────────────────────────
const PRANAV_MIGRATION_PROMPT = `\
You are a PostgreSQL migration expert. Given a Drizzle ORM schema, generate the equivalent
initial SQL migration (CREATE TABLE statements with constraints, FK references, indexes).

CRITICAL RULES — violations will break the app:
1. user_id columns that store Clerk user IDs MUST be TEXT NOT NULL, never UUID.
   Clerk returns string IDs like "user_2abc123def" — UUID columns will reject them.
   NEVER create a FK from tasks.user_id to a users table for Clerk apps.
2. Date/time columns like due_date, completed_at, deleted_at MUST be nullable
   (no NOT NULL) unless the schema explicitly marks them required.
3. Use gen_random_uuid() for UUID primary keys.
4. All timestamps: TIMESTAMP WITH TIME ZONE DEFAULT NOW().
5. Create indexes for all FK columns, user_id columns, and any unique columns.
6. Output ONLY the SQL — no markdown, no code fences, just raw SQL statements.
`;
