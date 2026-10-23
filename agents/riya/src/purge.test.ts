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

// Ledgerly run 4: the deploy agent edited db/migrations/0000_initial.sql and
// left check-db.js / fix-db.js scripts in the delivered project. It changes
// only deployment files now; an app bug goes to its builder.
test("the deploy agent may change deployment files only", async () => {
  const { isDeployFile } = await import("./index.ts");
  for (const p of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "backend/Dockerfile", "frontend/Dockerfile", "frontend/.dockerignore", ".env", "backend/.env.production"]) {
    expect({ p, ok: isDeployFile(p) }).toEqual({ p, ok: true });
  }
  for (const p of ["db/migrations/0000_initial.sql", "backend/src/index.ts", "check-db.js", "frontend/app/page.tsx", "frontend/package.json", "backend/src/docker/Dockerfile"]) {
    expect({ p, ok: isDeployFile(p) }).toEqual({ p, ok: false });
  }
  const src = (await import("node:fs")).readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  expect(src).toContain("writableFile: isDeployFile");
});

// 2026-10-04: with the data-safe redeploy, accounts made by checks stay in the
// database — and they are not all named verify+…: the sign-up check uses
// smoke+…, Tilotma's review uses testuser@…. All of them live on example.com, a
// reserved test domain no real person has. The cleanup removes every account on
// it, and runs again when the live review ends.
test("the cleanup covers every account on the reserved test domain, and runs after the live review", async () => {
  const { VERIFICATION_EMAIL_PATTERN } = await import("./index.ts");
  expect(VERIFICATION_EMAIL_PATTERN).toBe("%@example.com");
  const src = (await import("node:fs")).readFileSync(new URL("../../../pipeline/orchestrator/stages/stage6-deployment.ts", import.meta.url), "utf-8");
  expect(src).toContain("purgeVerificationArtifacts(");
});

// 2026-10-05 (Amit): test data is generated, the app is tested with it, and then it must all be gone. "Gone" is
// checked, not assumed: row counts of every table before the testing are compared with the counts after the
// cleanup. A table that holds more rows afterwards names data the cleanup could not remove.
test("compareSnapshots names every table that holds more rows than before, and ignores the rest", async () => {
  const { compareSnapshots } = await import("./index.ts");
  expect(compareSnapshots({ users: 0, clients: 0 }, { users: 0, clients: 0 })).toEqual([]);
  expect(compareSnapshots({ users: 3, clients: 2 }, { users: 3, clients: 2 })).toEqual([]);
  expect(compareSnapshots({ users: 0, clients: 0, invoices: 0 }, { users: 0, clients: 2, invoices: 1 })).toEqual([
    "clients: 0 rows before the testing, 2 after the cleanup",
    "invoices: 0 rows before the testing, 1 after the cleanup",
  ]);
  // a table that is new after the testing counts too; fewer rows than before is not "left behind" test data
  expect(compareSnapshots({ a: 5 }, { a: 4, b: 1 })).toEqual(["b: 0 rows before the testing, 1 after the cleanup"]);
});

// 2026-10-22 (Trailhead Gear Rentals): the deploy failed three times on "contact_submissions: 16 rows before the
// testing, 20 after the cleanup". The cleanup only looked in tables that hold accounts, but the checks also fill a
// public form table (a contact form: an email, no password) with @example.com test rows, and each retry added more.
// Such a table is now cleaned too, but only for rows made since the testing began, so a customer's own rows stay.
test("public-form tables are found by an email plus a created_at column and no password column", async () => {
  const { PUBLIC_FORM_TABLES_SQL } = await import("./index.ts");
  expect(PUBLIC_FORM_TABLES_SQL).toContain("column_name='email'");
  expect(PUBLIC_FORM_TABLES_SQL).toContain("column_name='created_at'");
  expect(PUBLIC_FORM_TABLES_SQL).toContain("NOT EXISTS");
  expect(PUBLIC_FORM_TABLES_SQL).toContain("password_hash");
});

test("the rows made since the testing began are chosen by time, whatever address they use", async () => {
  // 2026-10-23 (Trailhead rerun): the live evaluator sent the contact form as alex@trailtest.com, a made-up address on no
  // test domain; the row stayed and failed the deploy. During testing the app listens only on this machine, so every
  // public-form row made in the window comes from the checks. Rows from before the window are never touched.
  const { testWindowCondition } = await import("./index.ts");
  expect(testWindowCondition("2026-10-22 01:20:00.123456+00")).toBe(`created_at >= '2026-10-22 01:20:00.123456+00'`);
  expect(testWindowCondition("2026-10-22T01:20:00.123Z")).toBe(`created_at >= '2026-10-22T01:20:00.123Z'`);
  // the value goes into SQL text, so anything that is not a timestamp is refused
  expect(() => testWindowCondition("x'; DROP TABLE users; --")).toThrow();
  expect(() => testWindowCondition("")).toThrow();
});

test("test accounts on any reserved test domain are removed, real addresses are not", async () => {
  // Same rerun: the evaluator signed up as newuser9988@outdoorcamp.test. .test, .example, .invalid and .localhost are
  // reserved for testing (RFC 2606/6761), as are example.com/.net/.org; no real person can hold such an address.
  const { TEST_ACCOUNT_CONDITION, isTestAccountEmail } = await import("./index.ts");
  for (const e of ["verify+x@example.com", "a@example.net", "b@example.org", "newuser9988@outdoorcamp.test", "c@shop.example", "d@x.invalid", "e@app.localhost"]) expect({ e, ok: isTestAccountEmail(e) }).toEqual({ e, ok: true });
  for (const e of ["real.person@gmail.com", "owner@trailheadgear.com", "x@testing.com", "y@example.co"]) expect({ e, ok: isTestAccountEmail(e) }).toEqual({ e, ok: false });
  expect(TEST_ACCOUNT_CONDITION).toContain("ILIKE '%.test'");
});

test("the live review and Riya's own checks clean up public-form rows from when they began", async () => {
  const { readFileSync } = await import("node:fs");
  const stage6 = readFileSync(new URL("../../../pipeline/orchestrator/stages/stage6-deployment.ts", import.meta.url), "utf-8");
  expect(stage6).toContain("databaseNow(buildDir)");
  expect(stage6).toMatch(/purgeVerificationArtifacts\(buildDir, \w+\)/);
  const riya = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  expect(riya).toMatch(/purgeVerificationArtifacts\(buildDir, \w+\)/);
});

// 2026-10-05: the cleanup removes accounts on the reserved test domain — but only from tables that hold ACCOUNTS
// (an email plus a password hash). A customer's own clients table may hold an @example.com address as a
// placeholder; its rows are removed only through the test account they belong to.
test("the cleanup only looks for test accounts in tables that hold accounts", async () => {
  const { ACCOUNT_TABLES_SQL } = await import("./index.ts");
  expect(ACCOUNT_TABLES_SQL).toContain("column_name='email'");
  expect(ACCOUNT_TABLES_SQL).toContain("password_hash");
});
