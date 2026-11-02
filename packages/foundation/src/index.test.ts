import { test, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backendHeldFiles, putBackFoundation, foundationPlan, backendFoundationFiles, frontendFoundationFiles, writeFoundation, foundationChanges, withoutFoundationFiles, isFoundationFile } from "./index.ts";

// 2026-11-01 (Amit approved, after proof run 3): each build wrote login, roles, the answer format and the entry point from
// scratch, so the same kinds of bug could come back every time. These files are written once, tested once (backend.test.ts
// runs them for real), and given to every build; the builders write only what is specific to the app.

const users = (extra: Array<{ name: string; type?: string; notNull?: boolean; default?: string }> = []) => ({
  name: "users",
  columns: [
    { name: "id", type: "uuid", primaryKey: true },
    { name: "email", type: "text", notNull: true },
    { name: "password_hash", type: "text", notNull: true },
    { name: "role", type: "text", notNull: true, default: "'customer'" },
    { name: "created_at", type: "timestamptz", notNull: true, default: "now()" },
    ...extra,
  ],
});
const contract = (up = "/api/v1/auth/sign-up", inn = "/api/v1/auth/sign-in") => ({ endpoints: [{ method: "POST", path: up }, { method: "POST", path: inn }, { method: "GET", path: "/api/v1/menu" }] });

test("the sign-up and sign-in paths come from the contract", () => {
  const p = foundationPlan({ apiContract: contract("/api/v1/auth/register", "/api/v1/auth/login"), dbSchema: { tables: [users()] } });
  expect(p.auth).toMatchObject({ signUp: "register", signIn: "login" });
  const route = backendFoundationFiles(p).find((f) => f.path === "src/routes/auth.routes.ts")!.content;
  expect(route).toContain('router.post("/register", authVolumeLimiter, authLimiter, signUp)');
  expect(route).toContain('router.post("/login", authVolumeLimiter, authLimiter, signIn)');
});

test("sign-up never takes a role from the caller, and fills the name column only when the table has one", () => {
  const plain = backendFoundationFiles(foundationPlan({ apiContract: contract(), dbSchema: { tables: [users()] } })).find((f) => f.path === "src/controllers/auth.controller.ts")!.content;
  expect(plain).toContain("INSERT INTO users (email, password_hash) VALUES ($1, $2)");
  expect(plain).not.toMatch(/__[A-Z_]+__/);
  expect(plain).not.toContain("req.body.role");
  const named = backendFoundationFiles(foundationPlan({ apiContract: contract(), dbSchema: { tables: [users([{ name: "name", type: "text" }])] } })).find((f) => f.path === "src/controllers/auth.controller.ts")!.content;
  expect(named).toContain("INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)");
  expect(named).toContain("name: z.string()");
  expect(named).toContain(".optional()");
});

test("a required name column makes the name required at sign-up", () => {
  const c = backendFoundationFiles(foundationPlan({ apiContract: contract(), dbSchema: { tables: [users([{ name: "name", type: "text", notNull: true }])] } })).find((f) => f.path === "src/controllers/auth.controller.ts")!.content;
  expect(c).toContain("name: z.string()");
  expect(c).not.toContain(".optional()");
});

test("the login files are left to the builder when the plan has no login, or a users table they cannot fill", () => {
  const noAuth = foundationPlan({ apiContract: { endpoints: [{ method: "GET", path: "/api/v1/menu" }] }, dbSchema: { tables: [] } });
  expect(noAuth.auth).toBeNull();
  const paths = backendFoundationFiles(noAuth).map((f) => f.path);
  expect(paths).not.toContain("src/controllers/auth.controller.ts");
  expect(paths).toContain("src/app.ts");
  const required = foundationPlan({ apiContract: contract(), dbSchema: { tables: [users([{ name: "phone", type: "text", notNull: true }])] } });
  expect(required.auth).toBeNull();
  expect(required.authLeftToBuilder).toContain("phone");
});

test("the delivered files name nothing about how they were made", () => {
  const p = foundationPlan({ apiContract: contract(), dbSchema: { tables: [users()] } });
  for (const f of [...backendFoundationFiles(p), ...frontendFoundationFiles()]) {
    expect(f.content).not.toMatch(/nexsidi|yugnex|foundation|tilotma|shubham|aanya|pranav|brewline/i);
  }
});

test("foundation files are written with a record of their hashes; a change to one is found", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-"));
  const dir = join(root, "backend");
  try {
    const p = foundationPlan({ apiContract: contract(), dbSchema: { tables: [users()] } });
    const files = backendFoundationFiles(p);
    writeFoundation(dir, files);
    expect(readFileSync(join(dir, "src/http/respond.ts"), "utf-8")).toContain("success: true, data");
    expect(foundationChanges(dir)).toEqual([]);
    expect(existsSync(join(dir, ".nexsidi"))).toBe(false);
    writeFileSync(join(dir, "src/middleware/auth.ts"), "// weakened\n");
    expect(foundationChanges(dir)).toEqual(["src/middleware/auth.ts"]);
    expect(isFoundationFile(dir, "src/middleware/auth.ts")).toBe(true);
    expect(isFoundationFile(dir, "./src\\middleware\\auth.ts")).toBe(true);
    expect(isFoundationFile(dir, "src/controllers/menu.ts")).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the plan's tasks no longer ask a builder for a foundation file; a task left with nothing is dropped", () => {
  const tasks = [
    { id: "a", outputFiles: ["src/index.ts", "src/app.ts", "src/middleware/auth.ts"] },
    { id: "b", outputFiles: ["src/controllers/auth.controller.ts", "src/routes/auth.routes.ts", "src/controllers/menu.ts"] },
  ];
  const out = withoutFoundationFiles(tasks, ["src/index.ts", "src/app.ts", "src/middleware/auth.ts", "src/controllers/auth.controller.ts", "src/routes/auth.routes.ts"]);
  expect(out).toEqual([{ id: "b", outputFiles: ["src/controllers/menu.ts"] }]);
});

// 2026-11-01 (Brewline 7): a changed tested file could not be put back by the builder (the guard refuses it), so the build stopped.
test("putBackFoundation restores changed and deleted files, and leaves the builder's alone", () => {
  const root = mkdtempSync(join(tmpdir(), "base-"));
  const dir = join(root, "backend");
  const files = [{ path: "src/a.ts", content: "// a\n" }, { path: "src/b.ts", content: "// b\n" }];
  try {
    writeFoundation(dir, files);
    writeFileSync(join(dir, "src/own.ts"), "// mine\n");
    expect(putBackFoundation(dir, files)).toEqual([]);
    writeFileSync(join(dir, "src/a.ts"), "// changed\n");
    rmSync(join(dir, "src/b.ts"));
    expect(putBackFoundation(dir, files).sort()).toEqual(["src/a.ts", "src/b.ts"]);
    expect(foundationChanges(dir)).toEqual([]);
    expect(readFileSync(join(dir, "src/own.ts"), "utf-8")).toBe("// mine\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("putBackFoundation does not write a file other than the one recorded", () => {
  const root = mkdtempSync(join(tmpdir(), "base-"));
  const dir = join(root, "backend");
  try {
    writeFoundation(dir, [{ path: "src/a.ts", content: "// a\n" }]);
    writeFileSync(join(dir, "src/a.ts"), "// changed\n");
    expect(putBackFoundation(dir, [{ path: "src/a.ts", content: "// another version\n" }])).toEqual([]);
    expect(readFileSync(join(dir, "src/a.ts"), "utf-8")).toBe("// changed\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a plan's other names for the rate limiter are held too", () => {
  const held = backendHeldFiles(foundationPlan({ apiContract: { endpoints: [] }, dbSchema: { tables: [] } }));
  for (const f of ["src/middleware/rateLimit.ts", "src/middleware/rate-limit.ts", "src/middleware/rateLimiter.ts"]) expect(held).toContain(f);
});
