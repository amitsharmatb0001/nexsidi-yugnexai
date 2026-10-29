import { test, expect } from "bun:test";
import { nextMigrationFilename, generateDrizzleSchema } from "./index.ts";
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

// 2026-10-29: the single-call fix tests (a new migration from one model answer, SQL with or without a fence) moved to
// agent.test.ts with the database agent: it may write only a new migration and src/schema.ts (never an applied one).
