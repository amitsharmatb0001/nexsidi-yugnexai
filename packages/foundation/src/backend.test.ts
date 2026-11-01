import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import jwt from "jsonwebtoken";
import { Client } from "pg";
import { backendFoundationFiles, foundationPlan, writeFoundation } from "./index.ts";

// The foundation's proof: its files run as a real server on a real database, and every rule they keep is attacked over HTTP.
// It runs on a database of its own, dropped afterwards. Without Postgres it says so and is skipped, never passed in silence.

const adminUrl = process.env.DATABASE_URL ?? "";
let reachable = false;
if (adminUrl) {
  const c = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 2_000 });
  try {
    await c.connect();
    await c.end();
    reachable = true;
  } catch {
    reachable = false;
  }
}
if (!reachable) console.warn("[foundation] no Postgres reachable: the server tests are NOT run");

const dbName = `base_proof_${Date.now()}`;
const SECRET = "proof-secret-for-this-run-only-0123456789";
const ORIGIN = "http://localhost:4999";
const proofRoot = mkdtempSync(join(import.meta.dir, "..", ".proof-"));
const appDir = join(proofRoot, "backend");
let server: { close(): void } | undefined;
let base = "";
let db: Client;

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/v1${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const get = (path: string, token?: string) => fetch(`${base}/api/v1${path}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});

describe.skipIf(!reachable)("the foundation's server", () => {
  beforeAll(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    const url = new URL(adminUrl);
    url.pathname = `/${dbName}`;
    db = new Client({ connectionString: url.toString() });
    await db.connect();
    await db.query(`CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, name text, password_hash text NOT NULL, role text NOT NULL DEFAULT 'customer', created_at timestamptz NOT NULL DEFAULT now())`);

    const plan = foundationPlan({
      apiContract: { endpoints: [{ method: "POST", path: "/api/v1/auth/sign-up" }, { method: "POST", path: "/api/v1/auth/sign-in" }] },
      dbSchema: { tables: [{ name: "users", columns: [{ name: "id" }, { name: "email", notNull: true }, { name: "name" }, { name: "password_hash", notNull: true }, { name: "role", notNull: true, default: "'customer'" }] }] },
    });
    writeFoundation(appDir, backendFoundationFiles(plan));
    mkdirSync(join(appDir, "src/routes"), { recursive: true });
    // What a builder's routes look like on top of the foundation.
    writeFileSync(join(appDir, "src/routes/index.ts"), `import { Router } from "express";
import auth from "./auth.routes";
import { requireAuth, requireRole } from "../middleware/auth";
import { handler, ok } from "../http/respond";
const router = Router();
router.use("/auth", auth);
router.get("/me", requireAuth, (req, res) => ok(res, req.user));
router.get("/staff-only", requireAuth, requireRole("staff"), (_req, res) => ok(res, { secret: "for staff" }));
router.get("/boom", handler(async () => { throw new Error("database password is hunter2"); }));
export default router;
`);
    process.env.DATABASE_URL = url.toString();
    process.env.JWT_SECRET = SECRET;
    process.env.CORS_ORIGIN = ORIGIN;
    const { default: app } = await import(join(appDir, "src/app.ts"));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        base = `http://127.0.0.1:${(server as unknown as { address(): { port: number } }).address().port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    server?.close();
    const { pool } = await import(join(appDir, "src/db/pool.ts"));
    await pool.end();
    await db.end();
    process.env.DATABASE_URL = adminUrl;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
    rmSync(proofRoot, { recursive: true, force: true });
  });

  let customerToken = "";

  test("sign-up makes a customer, with the answer inside data and no password in it", async () => {
    const r = await post("/auth/sign-up", { email: "Ana@Example.com", password: "long-enough-1", name: "Ana" });
    expect(r.status).toBe(201);
    const a = (await r.json()) as { success: boolean; data: { token: string; user: Record<string, unknown> } };
    expect(a.success).toBe(true);
    expect(a.data.user).toMatchObject({ email: "ana@example.com", role: "customer", name: "Ana" });
    expect(JSON.stringify(a)).not.toContain("password");
    customerToken = a.data.token;
    const row = await db.query("SELECT password_hash FROM users WHERE email = 'ana@example.com'");
    expect(row.rows[0].password_hash).toStartWith("$2");
  });

  test("a caller cannot choose a role at sign-up", async () => {
    const r = await post("/auth/sign-up", { email: "mallory@example.com", password: "long-enough-2", role: "staff", isAdmin: true });
    expect(r.status).toBe(201);
    const a = (await r.json()) as { data: { user: { role: string } } };
    expect(a.data.user.role).toBe("customer");
  });

  test("a taken email, a bad email and a short password are refused in plain words", async () => {
    const taken = await post("/auth/sign-up", { email: "ana@example.com", password: "long-enough-3" });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ success: false, error: "An account with this email already exists" });
    expect((await post("/auth/sign-up", { email: "not-an-email", password: "long-enough-3" })).status).toBe(400);
    expect((await post("/auth/sign-up", { email: "b@example.com", password: "short" })).status).toBe(400);
  });

  test("sign-in works; a wrong password and an unknown email get the same answer", async () => {
    const good = await post("/auth/sign-in", { email: "ana@example.com", password: "long-enough-1" });
    expect(good.status).toBe(200);
    expect(JSON.stringify(await good.json())).not.toContain("password_hash");
    const wrong = await post("/auth/sign-in", { email: "ana@example.com", password: "wrong-password" });
    const unknown = await post("/auth/sign-in", { email: "nobody@example.com", password: "wrong-password" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  test("a signed-in page needs a real token: none, garbage, a forged one and an unsigned one are all refused", async () => {
    expect((await get("/me")).status).toBe(401);
    expect((await get("/me", "garbage")).status).toBe(401);
    const forged = jwt.sign({ sub: "1", email: "x@example.com", role: "staff" }, "another-secret");
    expect((await get("/me", forged)).status).toBe(401);
    const unsigned = `${btoa('{"alg":"none","typ":"JWT"}')}.${btoa('{"sub":"1","email":"x@example.com","role":"staff"}')}.`.replace(/=/g, "");
    expect((await get("/me", unsigned)).status).toBe(401);
    const expired = jwt.sign({ sub: "1", email: "x@example.com", role: "staff" }, SECRET, { expiresIn: -10 });
    expect((await get("/me", expired)).status).toBe(401);
    const me = await get("/me", customerToken);
    expect(me.status).toBe(200);
    expect(((await me.json()) as { data: { email: string } }).data.email).toBe("ana@example.com");
  });

  test("a role-limited page refuses a customer and lets staff in", async () => {
    expect((await get("/staff-only")).status).toBe(401);
    const refused = await get("/staff-only", customerToken);
    expect(refused.status).toBe(403);
    expect(JSON.stringify(await refused.json())).not.toContain("for staff");
    await db.query("UPDATE users SET role = 'staff' WHERE email = 'mallory@example.com'");
    const signedIn = (await (await post("/auth/sign-in", { email: "mallory@example.com", password: "long-enough-2" })).json()) as { data: { token: string } };
    expect((await get("/staff-only", signedIn.data.token)).status).toBe(200);
  });

  test("a crash answers 500 without its cause; unknown paths and broken JSON answer in the same format", async () => {
    const boom = await get("/boom");
    expect(boom.status).toBe(500);
    const text = await boom.text();
    expect(text).not.toContain("hunter2");
    expect(JSON.parse(text)).toEqual({ success: false, error: "Something went wrong" });
    const missing = await get("/no-such-path");
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { success: boolean }).success).toBe(false);
    const broken = await fetch(`${base}/api/v1/auth/sign-in`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
    expect(broken.status).toBe(400);
    expect(((await broken.json()) as { success: boolean }).success).toBe(false);
  });

  test("only the app's own frontend is allowed by CORS", async () => {
    const r = await fetch(`${base}/health`, { headers: { Origin: "https://evil.example" } });
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  test("sign-in is rate limited, and the refusal is in the same format", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 12; i++) {
      last = await post("/auth/sign-in", { email: "ana@example.com", password: "wrong-password" });
      if (last.status === 429) break;
    }
    expect(last!.status).toBe(429);
    expect(((await last!.json()) as { success: boolean }).success).toBe(false);
  });

  test("the app does not start without its secret", () => {
    const env = { ...process.env, JWT_SECRET: "" };
    const r = spawnSync("bun", ["-e", `await import(${JSON.stringify(join(appDir, "src/config.ts"))})`], { cwd: appDir, env, encoding: "utf-8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("JWT_SECRET is not set");
  });
});
