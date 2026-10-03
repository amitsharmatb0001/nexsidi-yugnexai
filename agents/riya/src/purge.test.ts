import { test, expect } from "bun:test";
import { buildPurgeStatements, type ForeignKey } from "./index.ts";

// 2026-10-03 (Ledgerly benchmark run 4): the deploy check's cleanup deleted
// its verify+ test users directly. The test client it had created points at
// the user (clients.user_id), so Postgres refused the delete and the test
// accounts and their data stayed in the delivered database. Rows that point
// at a test user are now deleted first, deepest first.

const FKS: ForeignKey[] = [
  { child: "clients", childColumn: "user_id", parent: "users", parentColumn: "id" },
  { child: "invoices", childColumn: "user_id", parent: "users", parentColumn: "id" },
  { child: "invoices", childColumn: "client_id", parent: "clients", parentColumn: "id" },
  { child: "invoice_items", childColumn: "invoice_id", parent: "invoices", parentColumn: "id" },
  { child: "audit", childColumn: "actor", parent: "other", parentColumn: "id" },
];

test("rows that point at a test user are deleted before the user, deepest first", () => {
  const sql = buildPurgeStatements("users", "email LIKE 'verify+%@example.com'", FKS);
  const at = (needle: string) => sql.findIndex((s) => s.startsWith(`DELETE FROM "${needle}"`));
  expect(sql[sql.length - 1]).toBe(`DELETE FROM "users" WHERE email LIKE 'verify+%@example.com'`);
  expect(at("invoice_items")).toBeLessThan(at("invoices"));
  expect(at("invoices")).toBeLessThan(at("clients"));
  expect(at("clients")).toBeLessThan(at("users"));
  expect(sql.some((s) => s.includes('"audit"'))).toBe(false);
  // each child delete is limited to rows of the test user
  const clients = sql.find((s) => s.startsWith('DELETE FROM "clients"'))!;
  expect(clients).toBe(`DELETE FROM "clients" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE email LIKE 'verify+%@example.com')`);
});

test("a table that points at itself or a cycle does not loop forever", () => {
  const sql = buildPurgeStatements("users", "email LIKE 'v%'", [
    { child: "users", childColumn: "invited_by", parent: "users", parentColumn: "id" },
    { child: "a", childColumn: "b_id", parent: "b", parentColumn: "id" },
    { child: "b", childColumn: "a_id", parent: "a", parentColumn: "id" },
    { child: "a", childColumn: "user_id", parent: "users", parentColumn: "id" },
  ]);
  expect(sql.length).toBeLessThan(20);
  expect(sql[sql.length - 1]).toBe(`DELETE FROM "users" WHERE email LIKE 'v%'`);
});

// Ledgerly run 4: the app answered only "Internal Server Error"; the real
// cause is in the backend's log. Its error lines go with the finding.
test("backendErrorLines keeps the error lines of a compose log, without the service prefix", async () => {
  const { backendErrorLines } = await import("./index.ts");
  const log = [
    "backend-1  | Server listening on 3001",
    "backend-1  | GET /health 200",
    "backend-1  | error: there is no unique or exclusion constraint matching the ON CONFLICT specification",
    "backend-1  |     at sequenceGenerator.ts:68",
  ].join("\n");
  expect(backendErrorLines(log)).toEqual(["error: there is no unique or exclusion constraint matching the ON CONFLICT specification"]);
});
