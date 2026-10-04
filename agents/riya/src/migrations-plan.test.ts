import { test, expect } from "bun:test";
import { planMigrations, migrationChecksum } from "./index.ts";

// 2026-10-04: every deploy ran DROP SCHEMA public CASCADE and re-applied all
// migrations — harmless while the app holds test data, but a redeploy after
// delivery would erase a customer's real invoices and clients. Rule: a
// database that holds rows is never dropped. Migrations already applied are
// remembered in a ledger table, and only new ones run.
const F = (name: string, body = name) => ({ name, checksum: migrationChecksum(body) });

test("an empty database is reset and every migration is applied", () => {
  const p = planMigrations({ rows: 0, ledger: null }, [F("0000_initial.sql"), F("0001_fix.sql")]);
  expect(p).toMatchObject({ reset: true, apply: ["0000_initial.sql", "0001_fix.sql"], adopt: false, errors: [] });
});

test("a database that holds rows is never reset; with no ledger every migration is tried and recorded", () => {
  const p = planMigrations({ rows: 12, ledger: null }, [F("0000_initial.sql")]);
  expect(p.reset).toBe(false);
  expect(p.apply).toEqual(["0000_initial.sql"]);
  expect(p.adopt).toBe(true);
});

test("with a ledger, only migrations not yet applied run — the data stays", () => {
  const ledger = new Map([["0000_initial.sql", migrationChecksum("0000_initial.sql")]]);
  const p = planMigrations({ rows: 500, ledger }, [F("0000_initial.sql"), F("0001_fix.sql")]);
  expect(p).toMatchObject({ reset: false, apply: ["0001_fix.sql"], adopt: false, errors: [] });
});

test("a migration edited after it was applied is an error when data exists, not a reason to drop it", () => {
  const ledger = new Map([["0000_initial.sql", migrationChecksum("old body")]]);
  const p = planMigrations({ rows: 3, ledger }, [F("0000_initial.sql", "new body")]);
  expect(p.reset).toBe(false);
  expect(p.apply).toEqual([]);
  expect(p.errors[0]).toContain("0000_initial.sql");
  expect(p.errors[0]).toContain("changed after it was applied");
});

test("the same edit on an empty database is harmless: reset and re-apply", () => {
  const ledger = new Map([["0000_initial.sql", migrationChecksum("old body")]]);
  const p = planMigrations({ rows: 0, ledger }, [F("0000_initial.sql", "new body")]);
  expect(p).toMatchObject({ reset: true, apply: ["0000_initial.sql"], errors: [] });
});

test("the data-safe plan is what the deploy step uses, and it no longer drops unconditionally", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  const fn = src.slice(src.indexOf("export function applyMigrationsToDeployedDb"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  expect(body).toContain("planMigrations(");
  expect(body).toContain("if (plan.reset)");
});
