import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildAppMap, saveAppMap, readAppMap, renderAppMap } from "./index.ts";

// 2026-10-30 (understanding plan, step 2): the app map joins what the code says into one picture of the app the system is
// building — and checks across it what no single file shows: the schema file against the migrations, SQL against the
// database, the frontend's calls against the backend's endpoints, each file's owner, and each plan item's endpoints,
// pages, tables and tests. No model.

let dir = "";
const write = (rel: string, text: string) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "appmap-all-"));
  write("db/migrations/0000_initial.sql", `CREATE TABLE "menu_items" ("id" uuid PRIMARY KEY, "name" text NOT NULL, "price" numeric(10,2) NOT NULL);
CREATE TABLE "order_items" ("id" uuid PRIMARY KEY, "menu_item_id" uuid NOT NULL REFERENCES "menu_items"("id") ON DELETE CASCADE, "price_at_time" numeric(10,2) NOT NULL);`);
  write("db/migrations/0001_fix.sql", `ALTER TABLE "order_items" ADD COLUMN "name_at_time" text NOT NULL DEFAULT '';`);
  write("db/src/schema.ts", `export const orderItems = pgTable("order_items", { id: uuid("id"), menu_item_id: uuid("menu_item_id"), price_at_time: numeric(10, 2) });
export const menuItems = pgTable("menu_items", { id: uuid("id"), name: text("name"), price: numeric(10, 2) });`);
  write("backend/src/app.ts", `const app = express();\napp.use("/api/v1", routes);\nimport routes from "./routes/orders";`);
  write("backend/src/routes/orders.ts", `const router = Router();
export const createOrder = async (req, res) => {
  await pool.query("INSERT INTO order_items (menu_item_id, price_at_time, quantity) VALUES ($1, $2, $3)", []);
};
export const getOrder = async (req, res) => {
  await pool.query("SELECT oi.id, mi.name FROM order_items oi JOIN menu_items mi ON oi.menu_item_id = mi.id WHERE oi.id = $1", []);
};
router.post("/orders", requireAuth, createOrder);
router.get("/orders/:id", requireAuth, getOrder);
export default router;`);
  write("frontend/app/order/page.tsx", `export default function P() { apiFetch("/api/v1/orders", { method: "POST" }); apiFetch("/api/v1/loyalty"); return null; }`);
  write("spec.json", JSON.stringify({ successCriteria: ["Customers place orders on /order."] }));
  write("api-contract.json", JSON.stringify({ endpoints: [
    { method: "POST", path: "/api/v1/orders", description: "Place an order." },
    { method: "GET", path: "/api/v1/orders/:id", description: "One order." },
  ] }));
  write("acceptance-tests.json", JSON.stringify({ writtenAt: "t", rejected: [], notWritten: [], tests: [
    { id: "AT-1-1", phase: 1, planItem: "EP1", title: "place an order", as: "user", kind: "api", steps: [{ method: "POST", path: "/api/v1/orders", expectStatus: 201 }] },
  ] }));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("the schema file is compared with the migrations", () => {
  expect(buildAppMap(dir).schemaDiff).toEqual([{ table: "order_items", column: "name_at_time", in: "migrations only" }]);
});

test("SQL that uses a column the database does not have is found, with its file and line", () => {
  expect(buildAppMap(dir).unknownColumns).toEqual([{ ref: "order_items.quantity", file: "backend/src/routes/orders.ts", line: 3, why: "order_items has no column quantity" }]);
});

test("the frontend's calls are matched to the backend's endpoints; a call with no endpoint is listed", () => {
  const m = buildAppMap(dir);
  expect(m.links.unmatchedCalls).toEqual([{ method: "GET", path: "/api/v1/loyalty", page: "/order", file: "frontend/app/order/page.tsx", line: 1 }]);
  expect(m.links.uncalledEndpoints).toEqual(["GET /api/v1/orders/:id"]);
});

test("every file has its owner; each plan item has its endpoints, pages and tests", () => {
  const m = buildAppMap(dir);
  expect(m.owners["backend/src/routes/orders.ts"]).toBe("shubham");
  expect(m.owners["db/migrations/0001_fix.sql"]).toBe("pranav");
  expect(m.owners["frontend/app/order/page.tsx"]).toBe("aanya");
  expect(m.plan.find((p) => p.item === "EP1")).toMatchObject({ endpoints: ["POST /api/v1/orders"], tests: ["AT-1-1"] });
  expect(m.plan.find((p) => p.item === "SC1")).toMatchObject({ pages: ["/order"] });
});

test("the map is kept in the build folder and read back", () => {
  const m = buildAppMap(dir);
  saveAppMap(dir, m);
  expect(readAppMap(dir)?.endpoints.length).toBe(2);
});

test("the map reads as plain facts: columns with their keys, what each endpoint writes and reads, the join, and the gaps", () => {
  const text = renderAppMap(buildAppMap(dir));
  expect(text).toContain("order_items: id uuid, menu_item_id uuid → menu_items.id (on delete CASCADE), price_at_time numeric(10,2), name_at_time text");
  expect(text).toContain("POST /api/v1/orders — createOrder (backend/src/routes/orders.ts) [requireAuth]");
  expect(text).toContain("writes order_items.menu_item_id, order_items.price_at_time, order_items.quantity");
  expect(text).toContain("INNER JOIN menu_items");
  expect(text).toContain("order_items.name_at_time is in the migrations but not in the schema file");
  expect(text).toContain("GET /api/v1/loyalty (from /order, frontend/app/order/page.tsx:1) matches no endpoint");
});
