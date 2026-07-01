// Pranav — Drizzle ORM migrations generator
// Produces complete Drizzle schema + migration SQL from a BuildPlan DB schema.
// Uses Qwen2.5-Coder 7B via local Ollama (GPU on Dell G15).

import { agentChat } from "@nexsidi/llm-client";
import { mkdirSync, writeFileSync } from "fs";
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

// ── Deterministic Drizzle schema generation (no LLM needed for structure) ────
// Arjun already spec'd the columns with drizzleType + constraints — just render it.
function generateDrizzleSchema(tables: DrizzleTable[]): string {
  const imports = new Set<string>([
    "pgTable", "sql", "relations",
    // collect all drizzle types used
    ...tables.flatMap((t) =>
      t.columns.map((c) => c.drizzleType.replace(/\(.*\)/, ""))
    ),
  ]);

  const importLine = `import { ${[...imports].sort().join(", ")} } from "drizzle-orm/pg-core";\n`;

  const tableBlocks = tables.map((table) => {
    const cols = table.columns.map((col) => renderColumn(col)).join(",\n  ");
    const indexBlock =
      table.indexes.length > 0
        ? `, (table) => ({\n  ${table.indexes.join(",\n  ")}\n})`
        : "";
    return `export const ${snakeToCamel(table.name)} = pgTable("${table.name}", {\n  ${cols}\n}${indexBlock});`;
  });

  // Relations block — infer from FK references
  const relationBlocks = tables
    .map((table) => buildRelationsBlock(table, tables))
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
