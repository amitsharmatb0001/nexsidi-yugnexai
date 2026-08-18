import { test, expect } from "bun:test";
import { nextMigrationFilename, runFix, getOutputDir, generateDrizzleSchema } from "./index.ts";
import type { BuildPlan, DrizzleTable } from "../../../arjun/src/index.ts";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 2026-08-18: real bug found live (RateGate) — Arjun's dbSchema-generation
// call is LLM-authored JSON with no strict structured-output schema
// enforcement, so it non-deterministically emitted a table shape with
// `fields: [{name, type, nullable, primaryKey, default}]` instead of the
// documented `columns: DrizzleColumn[]` shape, crashing generateDrizzleSchema
// with "TypeError: undefined is not an object (evaluating 't.columns.map')"
// and killing the whole generation stage. This test uses the EXACT real
// shape captured live from db-schema.json (backend/generators/pranav's own
// per-column normalizeColumn already handled col.type/nullable/primaryKey/
// default correctly — only the outer table-level property name was wrong).
test("generateDrizzleSchema does not crash when a table uses the LLM's alternate 'fields' shape instead of 'columns'", () => {
  const malformedTables = [
    {
      name: "status_logs",
      fields: [
        { name: "id", type: "uuid", nullable: false, primaryKey: true, default: "gen_random_uuid()" },
        { name: "service_name", type: "text", nullable: false, primaryKey: false, default: null },
        { name: "status", type: "text", nullable: false, primaryKey: false, default: "'operational'" },
        { name: "latency_ms", type: "integer", nullable: false, primaryKey: false, default: "0" },
      ],
    },
  ] as unknown as DrizzleTable[];

  const schema = generateDrizzleSchema(malformedTables);

  expect(schema).toContain("statusLogs");
  expect(schema).toContain("service_name");
  expect(schema).toContain(".primaryKey()");
  expect(schema).toContain(".notNull()");
});

test("generateDrizzleSchema still works normally for the documented 'columns' shape (no regression)", () => {
  const tables: DrizzleTable[] = [
    {
      name: "users",
      columns: [
        { name: "id", drizzleType: "uuid()", constraints: [".primaryKey()", ".default(sql`gen_random_uuid()`)"] },
        { name: "email", drizzleType: "text()", constraints: [".notNull()"] },
      ],
      indexes: [],
    },
  ];

  const schema = generateDrizzleSchema(tables);

  expect(schema).toContain("users");
  expect(schema).toContain("email");
  expect(schema).toContain(".notNull()");
});

// 2026-08-18: real bug found live (RateGate) — normalizeColumn appends "()"
// to a bare type name (e.g. "uuid" -> "uuid()"), then renderColumn
// unconditionally appended "(\"name\")" AFTER that, producing double-call
// syntax like `uuid()("id")` instead of valid Drizzle `uuid("id")`. This
// crashes `drizzle-kit generate`/`migrate`/`studio` on every single column,
// for every table — confirmed independently by both Navya and Karan against
// the live-generated db/src/schema.ts, and got QA's fix-loop stuck (5
// iterations, still failing) since Shubham's fix agent can't touch Pranav's
// generator. Asserts the render never double-calls the type function.
test("generateDrizzleSchema never emits double-call syntax like uuid()(\"id\") for any column", () => {
  const tables = [
    {
      name: "users",
      fields: [
        { name: "id", type: "uuid", nullable: false, primaryKey: true, default: "gen_random_uuid()" },
        { name: "email", type: "text", nullable: false, primaryKey: false, default: null },
        { name: "created_at", type: "timestamp", nullable: false, primaryKey: false, default: "now()" },
      ],
    },
  ] as unknown as DrizzleTable[];

  const schema = generateDrizzleSchema(tables);

  expect(schema).toContain('id: uuid("id")');
  expect(schema).toContain('email: text("email")');
  expect(schema).toContain('created_at: timestamp("created_at")');
  expect(schema).not.toMatch(/\(\)\(/);
});

// 2026-07-24 (P3.W3.4, full agentic upgrade): Pranav previously had NO fix
// path at all — a QA round whose findings were entirely db/-prefixed
// stopped the real GAN's fix loop immediately ("no auto-fix path yet").
// These tests cover the new expand-contract migration logic — CLAUDE.md
// D8 requires this NEVER rewrite an already-applied migration.

test("nextMigrationFilename starts at 0001 when the migrations dir is empty/missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "nexsidi-pranav-test-"));
  try {
    expect(nextMigrationFilename(join(dir, "nonexistent"), "fix")).toBe("0001_fix.sql");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("nextMigrationFilename picks the number right after the highest existing migration", () => {
  const dir = mkdtempSync(join(tmpdir(), "nexsidi-pranav-test-"));
  try {
    writeFileSync(join(dir, "0000_initial.sql"), "-- initial");
    expect(nextMigrationFilename(dir, "fix")).toBe("0001_fix.sql");

    writeFileSync(join(dir, "0001_fix.sql"), "-- first fix");
    expect(nextMigrationFilename(dir, "fix")).toBe("0002_fix.sql");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("nextMigrationFilename ignores files without a 4-digit numeric prefix", () => {
  const dir = mkdtempSync(join(tmpdir(), "nexsidi-pranav-test-"));
  try {
    writeFileSync(join(dir, "0000_initial.sql"), "-- initial");
    writeFileSync(join(dir, "README.md"), "not a migration");
    writeFileSync(join(dir, "notes.sql"), "no numeric prefix");
    expect(nextMigrationFilename(dir, "fix")).toBe("0001_fix.sql");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const TEST_PLAN: BuildPlan = {
  projectId: "pranav-fix-test",
  appName: "Test App",
  appDescription: "d",
  designBrief: {
    mood: "m",
    palette: [{ name: "ink", hex: "#000000" }, { name: "paper", hex: "#ffffff" }, { name: "accent", hex: "#ff0000" }],
    typography: { display: "d", body: "b" },
    layoutConcept: "l",
  },
  features: [],
  sharedTypes: "",
  apiContract: { baseUrl: "http://localhost:3001", endpoints: [] },
  dbSchema: { tables: [] },
  shubhamTasks: [],
  aanyaTasks: [],
  pranavTasks: [],
  independenceVerified: true,
  buildPlanHash: "hash",
};

test("runFix writes a NEW numbered migration file, never touching 0000_initial.sql (expand-contract, D8)", async () => {
  const buildDir = mkdtempSync(join(tmpdir(), "nexsidi-pranav-fix-test-"));
  const previousBuildDir = process.env.BUILD_DIR;
  process.env.BUILD_DIR = buildDir;

  try {
    const outputDir = getOutputDir(TEST_PLAN.projectId);
    const migrationsDir = join(outputDir, "migrations");
    mkdirSync(migrationsDir, { recursive: true });
    const initialSql = "CREATE TABLE users (id uuid PRIMARY KEY);";
    writeFileSync(join(migrationsDir, "0000_initial.sql"), initialSql);

    const stubChat = async () => ({
      content: "```sql\nALTER TABLE users ALTER COLUMN id TYPE text;\n```",
      modelUsed: "qwen2.5-coder:7b-instruct-q4_K_M" as const,
    });

    const result = await runFix(TEST_PLAN, ["[security/HIGH] users.id should be TEXT for Clerk IDs"], { chat: stubChat });

    expect(result.success).toBe(true);
    expect(result.filesWritten).toEqual(["migrations/0001_fix.sql"]);

    // The original migration is byte-for-byte untouched.
    expect(readFileSync(join(migrationsDir, "0000_initial.sql"), "utf-8")).toBe(initialSql);
    // The fix is a NEW, separate file.
    expect(existsSync(join(migrationsDir, "0001_fix.sql"))).toBe(true);
    expect(readFileSync(join(migrationsDir, "0001_fix.sql"), "utf-8")).toContain("ALTER TABLE users ALTER COLUMN id TYPE text;");
  } finally {
    if (previousBuildDir === undefined) delete process.env.BUILD_DIR;
    else process.env.BUILD_DIR = previousBuildDir;
    rmSync(buildDir, { recursive: true, force: true });
  }
});

test("runFix extracts raw SQL when the model doesn't wrap it in a code fence", async () => {
  const buildDir = mkdtempSync(join(tmpdir(), "nexsidi-pranav-fix-test-"));
  const previousBuildDir = process.env.BUILD_DIR;
  process.env.BUILD_DIR = buildDir;

  try {
    const stubChat = async () => ({
      content: "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);",
      modelUsed: "qwen2.5-coder:7b-instruct-q4_K_M" as const,
    });

    const result = await runFix(TEST_PLAN, ["[performance/MEDIUM] missing index on users.email"], { chat: stubChat });

    expect(result.success).toBe(true);
    const written = readFileSync(join(getOutputDir(TEST_PLAN.projectId), result.filesWritten[0]!), "utf-8");
    expect(written).toContain("CREATE INDEX IF NOT EXISTS idx_users_email");
  } finally {
    if (previousBuildDir === undefined) delete process.env.BUILD_DIR;
    else process.env.BUILD_DIR = previousBuildDir;
    rmSync(buildDir, { recursive: true, force: true });
  }
});
