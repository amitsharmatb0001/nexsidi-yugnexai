import { test, expect } from "bun:test";
import { isReadOnlyQuery } from "./db.ts";

test("allows a plain SELECT", () => {
  expect(isReadOnlyQuery("SELECT * FROM tasks LIMIT 5").ok).toBe(true);
});

test("allows a WITH ... SELECT (CTE)", () => {
  expect(isReadOnlyQuery("WITH t AS (SELECT 1) SELECT * FROM t").ok).toBe(true);
});

test("allows one trailing semicolon", () => {
  expect(isReadOnlyQuery("SELECT count(*) FROM tasks;").ok).toBe(true);
});

test("rejects INSERT", () => {
  const r = isReadOnlyQuery("INSERT INTO tasks (title) VALUES ('x')");
  expect(r.ok).toBe(false);
});

test("rejects UPDATE / DELETE / DROP / TRUNCATE", () => {
  for (const q of ["UPDATE tasks SET title='x'", "DELETE FROM tasks", "DROP TABLE tasks", "TRUNCATE tasks"]) {
    expect(isReadOnlyQuery(q).ok).toBe(false);
  }
});

test("rejects statement stacking (SELECT then a write)", () => {
  const r = isReadOnlyQuery("SELECT 1; DROP TABLE tasks");
  expect(r.ok).toBe(false);
});

test("rejects a write disguised after a SELECT-looking prefix via keyword scan", () => {
  // even without a semicolon, a stray write keyword is refused
  expect(isReadOnlyQuery("SELECT * FROM tasks WHERE id IN (DELETE ...)").ok).toBe(false);
});

test("rejects empty / non-select", () => {
  expect(isReadOnlyQuery("   ").ok).toBe(false);
  expect(isReadOnlyQuery("EXPLAIN ANALYZE SELECT 1").ok).toBe(false); // not SELECT/WITH-prefixed
});
