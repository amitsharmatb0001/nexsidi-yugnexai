import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildAppMap } from "./index.ts";
import { checkRules } from "./rules.ts";

// 2026-10-30 (understanding plan, step 3): the rules every app keeps (the one rulebook, baseline-rules.ts) are checked on
// the app map by code: each broken rule names the fact, the file and line, and the owner. The fixture breaks each rule
// once, in the way the generated apps have broken them.

let dir = "";
const write = (rel: string, text: string) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rules-"));
  write("db/migrations/0000.sql", `CREATE TABLE "users" ("id" uuid PRIMARY KEY, "email" text NOT NULL, "password_hash" text NOT NULL, "role" text NOT NULL);
CREATE TABLE "contacts" ("id" uuid PRIMARY KEY, "user_id" uuid REFERENCES "users"("id"), "name" text NOT NULL, "role" text);
CREATE TABLE "properties" ("id" uuid PRIMARY KEY, "title" text NOT NULL, "price" numeric NOT NULL);
CREATE TABLE "gear" ("id" uuid PRIMARY KEY, "name" text NOT NULL, "daily_price" numeric NOT NULL);
CREATE TABLE "bookings" ("id" uuid PRIMARY KEY, "waiver_signature_name" text, "total_price" numeric);
CREATE TABLE "booking_items" ("id" uuid PRIMARY KEY, "booking_id" uuid REFERENCES "bookings"("id"), "gear_id" uuid REFERENCES "gear"("id"), "gear_name" text, "daily_price" numeric, "quantity" integer);
CREATE TABLE "applications" ("id" uuid PRIMARY KEY, "user_id" uuid REFERENCES "users"("id"), "property_id" uuid REFERENCES "properties"("id"), "message" text);
CREATE TABLE "menu_items" ("id" uuid PRIMARY KEY, "name" text NOT NULL, "price" numeric NOT NULL, "in_stock" boolean NOT NULL);
CREATE TABLE "orders" ("id" uuid PRIMARY KEY, "user_id" uuid NOT NULL REFERENCES "users"("id"));
CREATE TABLE "order_items" ("id" uuid PRIMARY KEY, "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE, "menu_item_id" uuid NOT NULL REFERENCES "menu_items"("id") ON DELETE CASCADE, "price_at_time" numeric NOT NULL);`);
  write("backend/src/app.ts", `import routes from "./routes";\nconst app = express();\napp.use("/api/v1", routes);`);
  write("backend/src/routes/index.ts", `import { Router } from "express";
import orders from "./orders";
import auth from "./auth";
import search from "./search";
import tags from "./tags";
import tagsEsm from "./tags-esm.js";
const router = Router();
router.use("/orders", orders);
router.use("/auth", auth);
router.use("/search", search);
router.use("/tags", tags);
router.use("/tags-esm", tagsEsm);
export default router;`);
  write("backend/src/routes/auth.ts", `const router = Router();
router.post("/sign-up", async (req, res) => {
  const { email, role } = req.body;
  await pool.query("INSERT INTO users (email, role) VALUES ($1, $2)", [email, role]);
});
router.get("/search", async (req, res) => {
  await pool.query(\`SELECT id FROM users WHERE email = '\${req.query.email}'\`);
});
export default router;`);
  // Seen in stress-verify: the sign-in check is imported from another file of the backend, and that file is not a router.
  write("backend/src/middleware/auth.ts", `export const requireAuth = (req, res, next) => next();`);
  // Seen in the task builds: request values that reach the SQL text only as fixed text.
  write("backend/src/routes/search.ts", [
    `const ORDER_BY = { newest: "created_at DESC", oldest: "created_at ASC" };`,
    `const SORTS = ["created_at", "title"];`,
    `export const list = async (req, res) => {`,
    `  const dir = String(req.query.order).toUpperCase() === "ASC" ? "ASC" : "DESC";`,
    `  const by = ORDER_BY[String(req.query.sort)] || "created_at DESC";`,
    `  const limit = parseInt(req.query.limit as string) || 10;`,
    `  const sortBy = (req.query.sortBy as string) || "created_at";`,
    `  if (!SORTS.includes(sortBy)) return res.status(400).json({});`,
    "  await pool.query(`SELECT id FROM orders ORDER BY ${by}, ${sortBy} ${dir} LIMIT ${limit}`);",
    `};`,
    `export const addContact = async (req, res) => {`,
    `  const { name, role } = req.body;`,
    `  await pool.query("INSERT INTO contacts (name, role) VALUES ($1, $2)", [name, role]);`,
    `};`,
    // stress6qafix: the sort clause comes from a helper that returns a lookup in a fixed map
    `const ORDER_MAP = { due: "due_date ASC" };`,
    `function orderClause(sort: unknown): string {`,
    `  const s = typeof sort === "string" ? sort : "";`,
    `  return ORDER_MAP[s] || "created_at DESC";`,
    `}`,
    `export const listSorted = async (req, res) => {`,
    "  await pool.query(`SELECT id FROM orders ORDER BY ${orderClause(req.query.sort)}`);",
    `};`,
    // test9005: the handler checks sign-in itself
    `export const mine = async (req, res) => {`,
    `  const { userId } = getAuth(req);`,
    `  if (!userId) return res.status(401).json({ error: "Unauthorized" });`,
    `};`,
    `const router = Router();`,
    `router.get("/", list);`,
    `router.get("/sorted", listSorted as any);`,
    `router.get("/mine", mine);`,
    `router.post("/contacts", addContact);`,
    `export default router;`,
  ].join("\n"));
  // test9004: handlers named through a namespace import
  write("backend/src/routes/tags.ts", `import * as tagController from "../controllers/tags";
const router = Router();
router.get("/", tagController.listTags);
export default router;`);
  // Trailhead: the catalog listing joins the line table but reads the catalog
  write("backend/src/routes/gear.ts", `export const listGear = async () => { await pool.query("SELECT g.id, g.name, g.daily_price FROM gear g LEFT JOIN booking_items bi ON bi.gear_id = g.id"); };`);
  // 7e1ab88dc56a: a check script reads Postgres's own catalog
  write("backend/src/verify-db.ts", `export const check = async () => { await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = $1", ["users"]); };`);
  // f00dface0042: one shared client, the method as its own argument, the query string joined onto the path
  write("frontend/lib/api.ts", [
    `export const signIn = (body) => request("/api/v1/auth/sign-up", "POST", body);`,
    "export const list = (query: string) => request(`/api/v1/search${query}`, \"GET\");",
    `export const missing = () => request("/api/v1/nowhere", "GET");`,
    `export const menu = () => request("/api/v1/menu", "GET");`,
  ].join("\n"));
  write("frontend/app/page.tsx", `import { signIn, list, missing } from "../lib/api";\nexport default function Home() { return null; }`);
  // verify361300: an endpoint the frontend serves itself
  write("frontend/app/api/auth/token/route.ts", `export async function POST(req: Request) { return new Response("ok"); }`);
  write("frontend/app/sign-in/page.tsx", `export default function SignIn() { fetch("/api/auth/token", { method: "POST" }); return null; }`);
  // test9003: an ESM-style import names the compiled .js file
  write("backend/src/routes/tags-esm.ts", `import { listTags } from "../controllers/tags.js";
const router = Router();
router.get("/", listTags);
export default router;`);
  write("frontend/app/about/page.tsx",`import { missing } from "../../lib/api";\nexport default function About() { return null; }`);
  write("backend/src/controllers/tags.ts",`export const listTags = async (req, res) => { await pool.query("SELECT id FROM orders"); };`);
  write("backend/src/routes/orders.ts", `import { requireAuth } from "../middleware/auth";
const router = Router();
router.get("/public", async (req, res) => { await pool.query("SELECT id FROM orders"); });
router.use(requireAuth);
export const createOrder = async (req, res) => {
  const items = await pool.query("SELECT id, name, price, in_stock FROM menu_items WHERE id = ANY($1)", [req.body.ids]);
  await pool.query("INSERT INTO order_items (order_id, menu_item_id, price_at_time) VALUES ($1, $2, $3)", []);
};
export const getOrder = async (req, res) => {
  await pool.query("SELECT oi.id, mi.name, mi.price FROM order_items oi JOIN menu_items mi ON oi.menu_item_id = mi.id", []);
};
router.post("/", createOrder);
router.get("/:id", getOrder);
router.delete("/:id", async (req, res) => { await pool.query("DELETE FROM orders WHERE id = $1", [req.params.id]); });
export default router;`);
  write("api-contract.json", JSON.stringify({ endpoints: [
    { method: "POST", path: "/api/v1/auth/sign-up", auth: false, description: "Customer registration." },
    { method: "GET", path: "/api/v1/orders/public", auth: true, description: "Signed-in users." },
    { method: "POST", path: "/api/v1/orders", auth: true, description: "Place an order." },
    { method: "GET", path: "/api/v1/orders/:id", auth: true, description: "One order." },
    { method: "DELETE", path: "/api/v1/orders/:id", auth: true, description: "Delete an order (staff only)." },
    { method: "GET", path: "/api/v1/search/mine", auth: true, description: "My searches." },
    { method: "GET", path: "/api/v1/menu", auth: false, description: "The menu." },
    { method: "GET", path: "/api/v1/search/sorted", description: "Sorted (no auth field: not checked)." },
  ] }));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const rules = () => checkRules(dir, buildAppMap(dir));
const of = (rule: string) => rules().filter((v) => v.rule === rule);

test("router-level middleware counts for the routes after it, not before", () => {
  const m = buildAppMap(dir);
  expect(m.endpoints.find((e) => e.path === "/api/v1/orders" && e.method === "POST")!.middleware).toContain("requireAuth");
  expect(m.endpoints.find((e) => e.path === "/api/v1/orders/public")!.middleware).not.toContain("requireAuth");
});

test("INT1: an order line must keep the item's name and price, and deleting the item must not delete or hide the line", () => {
  const v = of("INT1");
  expect(v.map((x) => x.fact)).toEqual(expect.arrayContaining([
    expect.stringContaining("order_items keeps no copy of menu_items.name"),
    expect.stringContaining("deleting a menu_items row deletes its order_items lines (ON DELETE CASCADE)"),
    expect.stringContaining("reads the price from menu_items.price, the current value"),
  ]));
  expect(v.find((x) => x.fact.includes("keeps no copy"))).toMatchObject({ owner: "pranav", file: "db/migrations/0000.sql" });
  expect(v.find((x) => x.fact.includes("current value"))).toMatchObject({ owner: "shubham", file: "backend/src/routes/orders.ts" });
  // No name copy yet: the missing column is the database builder's fact, not a backend finding it could not fix.
  expect(v.some((x) => x.owner === "shubham" && x.fact.includes("menu_items.name"))).toBe(false);
});

test("SEC1: SQL built from request values is found; the owner is the file's", () => {
  expect(of("SEC1")).toEqual([expect.objectContaining({ owner: "shubham", file: "backend/src/routes/auth.ts", line: 7 })]);
});

test("SEC2: an endpoint the contract marks as signed-in must check sign-in before its handler; a role-limited one must check the role", () => {
  const v = of("SEC2").map((x) => x.fact);
  expect(v).toEqual(expect.arrayContaining([
    expect.stringContaining("GET /api/v1/orders/public needs sign-in"),
    expect.stringContaining("DELETE /api/v1/orders/:id is limited to staff"),
  ]));
  expect(v.some((f) => f.includes("POST /api/v1/orders needs"))).toBe(false);
});

test("router-level middleware imported from another file counts, and that file is not a mount", () => {
  const m = buildAppMap(dir);
  expect(m.endpoints.find((e) => e.path === "/api/v1/orders/:id" && e.method === "DELETE")!.middleware).toContain("requireAuth");
});

test("SEC1: a request value that reaches the SQL text only as fixed text (a choice of literals, a fixed map, a number, a value checked against a fixed list) is not flagged", () => {
  expect(of("SEC1").filter((v) => v.file.endsWith("search.ts"))).toEqual([]);
});

test("a cast handler (`listSorted as any`) and a handler named through a namespace import are found", () => {
  const m = buildAppMap(dir);
  expect(m.endpoints.find((e) => e.path === "/api/v1/search/sorted")).toMatchObject({ handler: "listSorted" });
  expect(m.endpoints.find((e) => e.path === "/api/v1/tags")).toMatchObject({ handler: "listTags", handlerFile: "backend/src/controllers/tags.ts" });
  expect(m.endpoints.find((e) => e.path === "/api/v1/tags")!.sql).toHaveLength(1);
});

test("SEC2: a handler that answers 401 itself checks sign-in; an endpoint whose contract states no auth is not checked", () => {
  const v = of("SEC2").map((x) => x.fact);
  expect(v.some((f) => f.includes("/search/mine") || f.includes("/search/sorted"))).toBe(false);
});

test("MAP: a positional method and a joined query string are read right; one call is one violation, whatever pages reach it; the Postgres catalog is not the app's", () => {
  const v = of("MAP");
  expect(v.filter((x) => x.fact.includes("matches no endpoint"))).toEqual([
    expect.objectContaining({ owner: "aanya", file: "frontend/lib/api.ts", line: 3, fact: expect.stringContaining("GET /api/v1/nowhere (from /, /about)") }),
  ]);
  expect(v.some((x) => x.file.endsWith("verify-db.ts"))).toBe(false);
});

test("MAP: a call the contract lists but the backend does not serve is the backend's", () => {
  expect(of("MAP").filter((x) => x.fact.includes("/api/v1/menu"))).toEqual([
    expect.objectContaining({ owner: "shubham", fact: expect.stringContaining("is in the contract") }),
  ]);
});

test("an ESM-style .js import finds the .ts file, and a call served by a Next.js route handler is matched", () => {
  const m = buildAppMap(dir);
  expect(m.endpoints.find((e) => e.path === "/api/v1/tags-esm")).toMatchObject({ handler: "listTags", handlerFile: "backend/src/controllers/tags.ts" });
  expect(m.links.unmatchedCalls.some((c) => c.path === "/api/auth/token")).toBe(false);
});

test("INT1: the line's header (booking_items → bookings) is not an item, and a catalog listing is not a read of the history", () => {
  const v = of("INT1").map((x) => x.fact);
  expect(v.some((f) => f.includes("bookings."))).toBe(false);
  expect(v.some((f) => f.includes("listGear"))).toBe(false);
});

test("SEC9: only the account table's role counts; a contact's role is a job title", () => {
  expect(of("SEC9").filter((v) => v.fact.includes("contacts.role"))).toEqual([]);
});

test("INT1: a table that points at a priced item but has no price or quantity of its own is not an order line", () => {
  expect(of("INT1").filter((v) => v.fact.includes("applications"))).toEqual([]);
});

test("SEC9: sign-up may not take the role from the request", () => {
  expect(of("SEC9")).toEqual([expect.objectContaining({ file: "backend/src/routes/auth.ts", fact: expect.stringContaining("users.role is written from the request") })]);
});

test("INT2: a stock check followed by a write must lock the rows in a transaction", () => {
  expect(of("INT2")).toEqual([expect.objectContaining({ file: "backend/src/routes/orders.ts", fact: expect.stringContaining("reads menu_items.in_stock and then writes") })]);
});

test("every violation's file is in its owner's folder, so the review sends it to the owner", async () => {
  const { agentForFile } = await import("../stages/stage4-multi-agent-dev.ts");
  const v = rules();
  expect(v.length).toBeGreaterThan(5);
  for (const x of v) expect(`${x.rule} ${x.file} → ${agentForFile(x.file)}`).toBe(`${x.rule} ${x.file} → ${x.owner}`);
});
