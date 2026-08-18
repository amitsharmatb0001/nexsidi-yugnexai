// Pranav — Drizzle ORM migrations generator
// Produces complete Drizzle schema + migration SQL from a BuildPlan DB schema.
// Uses Qwen2.5-Coder 7B via local Ollama (GPU on Dell G15).

import { agentChat } from "@nexsidi/llm-client";
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import type { BuildPlan, DrizzleTable, DrizzleColumn } from "../../../arjun/src/index.ts";
import type { GeneratorResult } from "../../shubham/src/index.ts";

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

// 2026-07-24 (P3.W3.4, full agentic upgrade): Pranav previously had no fix
// path at all — the real GAN's fix loop (stage5-qa-fix-loop.ts) explicitly
// gave up the moment a QA round's findings were ALL db/-prefixed ("no
// auto-fix path yet. Stop rather than loop uselessly"). This is that path.
//
// Deliberately NOT the same shape as Shubham/Aanya's runFix (a tool-calling
// agent loop that rewrites files directly): a DB fix is a NEW migration
// file that ALTERs the existing schema, never a rewrite of migration 0000
// or the live schema.ts — CLAUDE.md D8 ("expand-contract migrations
// only") applies precisely because migration 0000 may already be applied
// to a running Postgres instance by the time a QA round finds a problem
// with it. schema.ts IS updated (Drizzle's schema file must reflect the
// post-fix shape for future codegen), but only additively/compatibly.
//
// `deps` is injectable (defaults to the real agentChat) — matches this
// codebase's established DI pattern (Saanvi/Arjun/Vanya's run()) so this
// is unit-testable without a live LLM call or mock.module (which risks
// bleeding into other test files sharing bun's module cache).
export interface PranavFixDeps {
  chat: typeof agentChat;
}

export async function runFix(
  plan: BuildPlan,
  findings: string[],
  deps: PranavFixDeps = { chat: agentChat },
): Promise<GeneratorResult> {
  const outputDir = getOutputDir(plan.projectId);
  const migrationsDir = join(outputDir, "migrations");
  const filesWritten: string[] = [];
  const errors: string[] = [];

  try {
    const existingSchema = readExistingSchema(outputDir);
    const fixSql = await generateFixMigrationSql(existingSchema, findings, deps);
    const filename = nextMigrationFilename(migrationsDir, "fix");
    const migrationPath = join(migrationsDir, filename);
    mkdirSync(migrationsDir, { recursive: true });
    writeFileSync(migrationPath, fixSql, "utf-8");
    filesWritten.push(`migrations/${filename}`);
  } catch (err) {
    errors.push(String(err));
  }

  return { success: errors.length === 0, projectId: plan.projectId, outputDir, filesWritten, errors };
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

async function generateFixMigrationSql(existingSchema: string, findings: string[], deps: PranavFixDeps): Promise<string> {
  const { content } = await deps.chat(
    "pranav",
    [
      { role: "system", content: PRANAV_FIX_PROMPT },
      {
        role: "user",
        content: `EXISTING SCHEMA (already applied — do not recreate these tables):\n${existingSchema}\n\nQA FINDINGS TO FIX:\n${findings.map((f) => `- ${f}`).join("\n")}`,
      },
    ],
    process.env.NIM_API_KEY ?? "",
  );

  const sqlMatch = content.match(/```sql\s*([\s\S]*?)\s*```/) ?? content.match(/```\s*([\s\S]*?)\s*```/);
  return sqlMatch?.[1]?.trim() ?? content.trim();
}

const PRANAV_FIX_PROMPT = `\
You are a PostgreSQL migration expert fixing specific issues in an ALREADY-DEPLOYED
schema. You are writing a NEW, ADDITIVE migration — never regenerate or DROP an
existing table. This is expand-contract only:

CRITICAL RULES:
1. Use ALTER TABLE, CREATE INDEX, or ADD CONSTRAINT to fix issues — never DROP TABLE,
   never CREATE TABLE for a table that already exists in the existing schema shown.
2. If a column's type is wrong (e.g. UUID where it should be TEXT for Clerk user IDs),
   use ALTER TABLE ... ALTER COLUMN ... TYPE ... — with a USING clause if the existing
   data needs conversion.
3. If a column should be nullable and isn't (or vice versa), use ALTER TABLE ... ALTER
   COLUMN ... DROP NOT NULL / SET NOT NULL.
4. If an index is missing, use CREATE INDEX IF NOT EXISTS.
5. Address ONLY the findings listed — do not "improve" unrelated parts of the schema.
6. Output ONLY the SQL — no markdown, no code fences, just raw ALTER/CREATE INDEX statements.
`;

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

function renderColumn(col: DrizzleColumn): string {
  const constraints = col.constraints.join("");
  const ref = col.references
    ? `.references(() => ${snakeToCamel(col.references.split(".")[0] ?? "")}.${col.references.split(".")[1] ?? "id"})`
    : "";
  return `${col.name}: ${col.drizzleType}("${col.name}")${constraints}${ref}`;
}

function buildRelationsBlock(table: DrizzleTable, allTables: DrizzleTable[]): string {
  const fkCols = table.columns.filter((c) => c.references);
  if (fkCols.length === 0) return "";

  const relName = snakeToCamel(table.name);
  const relLines = fkCols.map((col) => {
    const [refTable] = (col.references ?? "").split(".");
    const refName = snakeToCamel(refTable ?? "");
    const fieldName = col.name.replace(/_id$/, "");
    return `  ${fieldName}: one(${refName}, { fields: [${relName}.${col.name}], references: [${refName}.id] })`;
  });

  const hasChildren = allTables.some((t) =>
    t.columns.some((c) => c.references?.startsWith(`${table.name}.`))
  );
  if (hasChildren) {
    const childRels = allTables
      .filter((t) => t.columns.some((c) => c.references?.startsWith(`${table.name}.`)))
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
  return join(process.env.BUILD_DIR ?? "/tmp/nexsidi-builds", projectId, "db");
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
