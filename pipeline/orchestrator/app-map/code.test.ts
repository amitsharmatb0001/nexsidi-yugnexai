import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readBackend, readFrontend, readDrizzleSchema } from "./code.ts";

// 2026-10-30 (understanding plan, step 2): the app map reads the generated code from its syntax tree (the TypeScript
// compiler, no model): the backend's mounts, endpoints, handlers and the SQL each handler runs; the frontend's pages and
// the API calls they make; the Drizzle schema's columns. The fixture is written the way the generated apps are.

let dir = "";
const write = (rel: string, text: string) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "appmap-"));
  write("backend/src/app.ts", `import express from "express";
import routes from "./routes";
const app = express();
app.use(express.json());
app.use("/api/v1", routes);
export default app;`);
  write("backend/src/routes/index.ts", `import { Router } from "express";
import orderRoutes from "./orders";
import authRoutes from "./auth";
const router = Router();
router.use("/orders", orderRoutes);
router.use("/auth", authRoutes);
export default router;`);
  write("backend/src/routes/auth.ts", `import { Router } from "express";
import { signUp } from "../controllers/auth";
const router = Router();
router.post("/sign-up", authLimiter, signUp);
export default router;`);
  write("backend/src/controllers/auth.ts", `import { pool } from "../db/pool";
export async function signUp(req, res) {
  const { email } = req.body;
  const existing = await pool.query(\`SELECT id FROM users WHERE email = '\${email}'\`);
  await pool.query("INSERT INTO users (email, password_hash) VALUES ($1, $2)", [email, "x"]);
}`);
  write("backend/src/routes/orders.ts", `import { Router } from "express";
import { pool } from "../db/pool";
const router = Router();
const lineSql = "INSERT INTO order_items (order_id, menu_item_id, price_at_time, name_at_time) VALUES ($1, $2, $3, $4)";
async function saveLines(client, orderId, items) {
  for (const it of items) await client.query(lineSql, [orderId, it.id, it.price, it.name]);
}
export const createOrderHandler = async (req, res) => {
  const client = await pool.connect();
  const r = await client.query("INSERT INTO orders (user_id) VALUES ($1) RETURNING id", [req.user.id]);
  await saveLines(client, r.rows[0].id, req.body.items);
};
export const getOrderByIdHandler = async (req, res) => {
  const rows = await pool.query(\`
    SELECT oi.id, COALESCE(NULLIF(oi.name_at_time, ''), mi.name) AS name
    FROM order_items oi
    LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
    WHERE oi.order_id = $1\`, [req.params.id]);
};
router.post("/", requireAuth, createOrderHandler);
router.get("/:id", requireAuth, getOrderByIdHandler);
router.delete("/:id", requireStaff, async (req, res) => {
  await pool.query("DELETE FROM orders WHERE id = $1", [req.params.id]);
});
export default router;`);
  write("backend/src/routes/orders.test.ts", `router.get("/test-only", () => pool.query("SELECT 1"));`);
  write("db/src/schema.ts", `import { pgTable, uuid, text, numeric } from "drizzle-orm/pg-core";
export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey(),
  menu_item_id: uuid("menu_item_id").notNull(),
  price_at_time: numeric(10, 2).notNull(),
});`);
  write("frontend/lib/api.ts", `export async function apiFetch(endpoint: string, options: RequestInit = {}) {
  return fetch(\`\${process.env.NEXT_PUBLIC_API_URL}\${endpoint}\`, options);
}`);
  write("frontend/components/OrderForm.tsx", `import { apiFetch } from "@/lib/api";
export function OrderForm() {
  const submit = () => apiFetch("/api/v1/orders", { method: "POST", body: "{}" });
  const load = () => apiFetch("/api/v1/menu");
  return null;
}`);
  write("frontend/app/(shop)/order/page.tsx", `import { OrderForm } from "@/components/OrderForm";
export default function Page() { return <OrderForm />; }`);
  write("frontend/app/my-orders/[id]/page.tsx", `import { apiFetch } from "../../../lib/api";
export default function Page({ params }) { apiFetch(\`/api/v1/orders/\${params.id}\`); return null; }`);
  write("frontend/app/page.tsx", `export default function Home() { return null; }`);
  write("frontend/components/nexui/button.tsx", `export const Button = () => fetch("/api/v1/never-counted");`);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("endpoints get their full path from the mounts, with their middleware and handler", () => {
  const b = readBackend(join(dir, "backend"));
  expect(b.endpoints.map((e) => `${e.method} ${e.path} ${e.handler} [${e.middleware.join(",")}]`).sort()).toEqual([
    "DELETE /api/v1/orders/:id (inline) [requireStaff]",
    "GET /api/v1/orders/:id getOrderByIdHandler [requireAuth]",
    "POST /api/v1/auth/sign-up signUp [authLimiter]",
    "POST /api/v1/orders createOrderHandler [requireAuth]",
  ]);
  expect(b.endpoints.find((e) => e.handler === "signUp")!.handlerFile).toBe("backend/src/controllers/auth.ts");
});

test("each endpoint lists the SQL its handler runs, through the functions it calls and the constants it uses", () => {
  const b = readBackend(join(dir, "backend"));
  const create = b.endpoints.find((e) => e.handler === "createOrderHandler")!;
  expect(create.sql.map((q) => q.facts.kind)).toEqual(["insert", "insert"]);
  expect(create.sql[1]!.facts.writes).toContain("order_items.name_at_time");
  expect(create.sql[1]!.function).toBe("saveLines");
  const get = b.endpoints.find((e) => e.handler === "getOrderByIdHandler")!;
  expect(get.sql[0]!.facts.outputs).toContainEqual({ as: "name", from: ["order_items.name_at_time", "menu_items.name"] });
  expect(get.sql[0]!.facts.tables[1]).toMatchObject({ table: "menu_items", join: "left" });
  expect(b.endpoints.find((e) => e.method === "DELETE")!.sql[0]!.facts.deletes).toEqual(["orders"]);
});

test("SQL built from values is found with its file and line; test files are not the app", () => {
  const b = readBackend(join(dir, "backend"));
  const dynamic = b.sql.filter((q) => q.facts.builtFromValues);
  expect(dynamic.map((q) => `${q.file}:${q.line} ${q.function}`)).toEqual(["backend/src/controllers/auth.ts:4 signUp"]);
  expect(b.sql.some((q) => q.file.endsWith(".test.ts"))).toBe(false);
});

test("pages get their route from the folders, and their API calls through the components they import", () => {
  const f = readFrontend(join(dir, "frontend"));
  const byRoute = Object.fromEntries(f.pages.map((p) => [p.route, p.calls.map((c) => `${c.method} ${c.path}`).sort()]));
  expect(byRoute).toEqual({
    "/": [],
    "/order": ["GET /api/v1/menu", "POST /api/v1/orders"],
    "/my-orders/[id]": ["GET /api/v1/orders/:param"],
  });
});

test("the Drizzle schema's tables and column names are read, a column without a name by its key", () => {
  expect(readDrizzleSchema(join(dir, "db"))).toEqual({ order_items: ["id", "menu_item_id", "price_at_time"] });
});

// 2026-10-30 (the map on Brewline 3's real code): an UPDATE whose SET list is built in code from fixed column names, with
// the values as parameters, is read column by column and is not SQL built from values; a query text assigned in an if/else
// is read in both variants.
test("a SET list built in code from fixed columns is read, and its values are parameters", () => {
  write("backend/src/routes/menu.ts", `import { Router } from "express";
const router = Router();
export const updateMenu = async (req, res) => {
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (req.body.name !== undefined) { fields.push(\`name = $\${i++}\`); values.push(req.body.name); }
  if (req.body.price !== undefined) { fields.push(\`price = $\${i++}\`); values.push(req.body.price); }
  fields.push(\`updated_at = NOW()\`);
  const query = \`UPDATE menu_items SET \${fields.join(", ")} WHERE id = $\${i} RETURNING id\`;
  await pool.query(query, values);
};
export const listOrders = async (req, res) => {
  let ordersQuery;
  if (req.user.role === "staff") {
    ordersQuery = \`SELECT o.id FROM orders o\`;
  } else {
    ordersQuery = \`SELECT o.id FROM orders o WHERE o.user_id = $1\`;
  }
  await pool.query(ordersQuery, []);
};
router.patch("/menu/:id", updateMenu);
router.get("/orders-list", listOrders);
export default router;`);
  write("backend/src/routes/index.ts", `import { Router } from "express";
import orderRoutes from "./orders";
import authRoutes from "./auth";
import menuRoutes from "./menu";
const router = Router();
router.use("/orders", orderRoutes);
router.use("/auth", authRoutes);
router.use("/", menuRoutes);
export default router;`);
  const b = readBackend(join(dir, "backend"));
  const upd = b.endpoints.find((e) => e.handler === "updateMenu")!;
  expect(upd.sql[0]!.facts.writes).toEqual(["menu_items.name", "menu_items.price", "menu_items.updated_at"]);
  expect(upd.sql[0]!.facts.builtFromValues).toBe(false);
  const list = b.endpoints.find((e) => e.handler === "listOrders")!;
  expect(list.sql.map((q) => q.facts.filters)).toEqual([[], ["orders.user_id"]]);
  expect(b.notes.filter((n) => n.includes("menu.ts"))).toEqual([]);
});

// 2026-10-30 (the map on six other builds): a call's method comes from api.post even when its second argument is the body;
// a string method like endsWith("/api/v1") is not an API call; a router re-exported from another file keeps its prefix.
test("api.post with a body is a POST; a string check is not an API call", () => {
  write("frontend/app/contact/page.tsx", `import { api } from "@/lib/api";
export default function Contact() {
  const base = "http://x/api/v1";
  if (base.endsWith("/api/v1")) {}
  api.post("/api/v1/contact", { name: "a", email: "b" });
  return null;
}`);
  const f = readFrontend(join(dir, "frontend"));
  expect(f.pages.find((p) => p.route === "/contact")!.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/v1/contact"]);
});

test("a router re-exported from another file is mounted with its prefix", () => {
  write("backend/src/routes/plants.ts", `import { Router } from "express";
const plantRouter = Router();
plantRouter.get("/", listPlants);
export default plantRouter;`);
  write("backend/src/routes/plants.routes.ts", `import plantRouter from "./plants";\nexport default plantRouter;`);
  write("backend/src/routes/index.ts", `import { Router } from "express";
import orderRoutes from "./orders";
import authRoutes from "./auth";
import menuRoutes from "./menu";
import plantsRoutes from "./plants.routes";
const router = Router();
router.use("/orders", orderRoutes);
router.use("/auth", authRoutes);
router.use("/", menuRoutes);
router.use("/plants", plantsRoutes);
export default router;`);
  const b = readBackend(join(dir, "backend"));
  expect(b.endpoints.find((e) => e.handler === "listPlants")!.path).toBe("/api/v1/plants");
  expect(b.notes.filter((n) => n.includes("plants") && n.includes("mounted"))).toEqual([]);
});

// 2026-10-30 (Leafkeeper, shopbill-9): a handler imported through a barrel (`export * from "./tasksController"`) is found;
// a SET list built with "+" from fixed columns and parameter numbers is read like the template form.
test("a handler re-exported through export * is found, and a SET list built with + is read", () => {
  write("backend/src/controllers/tasksController.ts", `export const getTasks = async (req, res) => {
  const fields: string[] = [];
  let i = 1;
  fields.push("title = $" + (i++));
  fields.push("done = $" + (i++));
  await pool.query(\`UPDATE tasks SET \${fields.join(", ")} WHERE id = $\${i}\`, []);
};`);
  write("backend/src/controllers/tasks.ts", `export * from "./tasksController";`);
  write("backend/src/routes/plants.ts", `import { Router } from "express";
import { getTasks } from "../controllers/tasks";
const plantRouter = Router();
plantRouter.get("/", listPlants);
plantRouter.get("/:id/tasks", getTasks);
export default plantRouter;`);
  const b = readBackend(join(dir, "backend"));
  const e = b.endpoints.find((x) => x.handler === "getTasks")!;
  expect(e.handlerFile).toBe("backend/src/controllers/tasksController.ts");
  expect(e.sql[0]!.facts.writes).toEqual(["tasks.title", "tasks.done"]);
  expect(e.sql[0]!.facts.builtFromValues).toBe(false);
  expect(b.notes.filter((n) => n.includes("getTasks"))).toEqual([]);
});
