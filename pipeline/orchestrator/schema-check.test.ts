import { test, expect } from "bun:test";
import { schemaFromSql, insertedColumns, missingColumns } from "./schema-check.ts";

// 2026-10-13 (Shopbill Express Build): the backend editor changed the invoice INSERT to write po_reference,
// passed tsc and build, and never wrote the migration. The column did not exist, so every invoice failed with
// a 500. Nothing compared the SQL the code runs with the schema the migrations build.

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE public.invoices (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    invoice_number VARCHAR(50) NOT NULL,
    total BIGINT NOT NULL,
    UNIQUE (user_id, invoice_number),
    CONSTRAINT total_positive CHECK (total >= 0)
  );`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sac_code VARCHAR(20), ADD COLUMN notes TEXT;`,
];

test("the schema is read from CREATE TABLE and ALTER TABLE ... ADD COLUMN, skipping constraints", () => {
  const s = schemaFromSql(MIGRATIONS);
  expect([...s.get("users")!].sort()).toEqual(["created_at", "email", "id"]);
  expect([...s.get("invoices")!].sort()).toEqual(["id", "invoice_number", "notes", "sac_code", "total", "user_id"]);
});

test("INSERT column lists are found, across lines and inside template strings", () => {
  const code = "const r = await db.query(`INSERT INTO invoices (\n  user_id, invoice_number,\n  po_reference\n) VALUES ($1, $2, $3)`, [a, b, c]);";
  expect(insertedColumns(code)).toEqual([{ table: "invoices", columns: ["user_id", "invoice_number", "po_reference"] }]);
});

test("a column the code writes that no migration creates is reported", () => {
  const code = "db.query(`INSERT INTO invoices (user_id, invoice_number, po_reference) VALUES ($1, $2, $3)`)";
  expect(missingColumns(code, schemaFromSql(MIGRATIONS))).toEqual([{ table: "invoices", column: "po_reference" }]);
});

test("once a migration adds it, nothing is reported", () => {
  const code = "db.query(`INSERT INTO invoices (user_id, invoice_number, po_reference) VALUES ($1, $2, $3)`)";
  const withIt = [...MIGRATIONS, "ALTER TABLE invoices ADD COLUMN po_reference VARCHAR(50);"];
  expect(missingColumns(code, schemaFromSql(withIt))).toEqual([]);
});

test("a table no migration creates is reported, with its columns", () => {
  const code = "db.query(`INSERT INTO suppliers (name, state) VALUES ($1, $2)`)";
  expect(missingColumns(code, schemaFromSql(MIGRATIONS))).toEqual([
    { table: "suppliers", column: "name" },
    { table: "suppliers", column: "state" },
  ]);
});

test("a schema that could not be read says nothing, rather than reporting everything", () => {
  const code = "db.query(`INSERT INTO invoices (user_id) VALUES ($1)`)";
  expect(missingColumns(code, schemaFromSql(["-- empty"]))).toEqual([]);
});

test("placeholders and dynamic column lists are not mistaken for columns", () => {
  const code = "db.query(`INSERT INTO invoices (${cols.join(', ')}) VALUES (${marks})`)";
  expect(missingColumns(code, schemaFromSql(MIGRATIONS))).toEqual([]);
});
