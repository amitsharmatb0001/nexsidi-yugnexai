import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildAppMap } from "./index.ts";
import { structuralTrace, handoffFacts } from "./trace.ts";

// 2026-10-30 (understanding plan, step 4): the links from a plan item to the code that carries it, from facts — the
// endpoints, pages and tables the item names, and the requests and pages its acceptance tests use — then from each of those
// to its files (the route, the handler, the queries; the page and the files its calls are in; the migrations). The trace in
// packages/context-chain linked requirements to tasks by shared words.

let dir = "";
const write = (rel: string, text: string) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "trace-"));
  write("spec.json", JSON.stringify({ successCriteria: ["Customers see their past orders.", "Staff edit the menu_items table."] }));
  write("db/migrations/0000.sql", `CREATE TABLE "menu_items" ("id" uuid PRIMARY KEY, "name" text NOT NULL);
CREATE TABLE "orders" ("id" uuid PRIMARY KEY);
ALTER TABLE "orders" ADD COLUMN "note" text;`);
  write("db/migrations/0001.sql", `ALTER TABLE "menu_items" ADD COLUMN "price" numeric;`);
  write("backend/src/app.ts", `import orders from "./routes/orders";\nconst app = express();\napp.use("/api/v1/orders", orders);`);
  write("backend/src/routes/orders.ts", `import { listOrders } from "../controllers/orders";\nconst router = Router();\nrouter.get("/", listOrders);\nexport default router;`);
  write("backend/src/controllers/orders.ts", `export const listOrders = async (req, res) => { await pool.query("SELECT id FROM orders"); };`);
  write("frontend/lib/api.ts", `export const orders = () => fetch("/api/v1/orders");`);
  write("frontend/app/orders/page.tsx", `import { orders } from "../../lib/api";\nexport default function Orders() { orders(); return null; }`);
  write("acceptance-tests.json", JSON.stringify({ writtenAt: "t", rejected: [], notWritten: [], tests: [
    { id: "AT-1", phase: 1, planItem: "SC1", title: "past orders", as: "user", kind: "api", steps: [{ method: "GET", path: "/api/v1/orders", expectStatus: 200 }] },
    { id: "AT-2", phase: 1, planItem: "SC1", title: "orders page", as: "user", kind: "journey", steps: [{ do: "open", path: "/orders" }, { do: "see", text: "Orders" }] },
  ] }));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("a plan item reaches its endpoint through its tests, and the endpoint reaches the route, handler and query files", () => {
  const edges = structuralTrace(buildAppMap(dir), dir);
  const from = (f: string) => edges.filter((e) => e.from === f).map((e) => e.to);
  expect(from("SC1")).toEqual(expect.arrayContaining(["endpoint:GET /api/v1/orders", "page:/orders"]));
  expect(edges.find((e) => e.from === "SC1" && e.to === "endpoint:GET /api/v1/orders")!.reason).toContain("AT-1");
  expect(from("endpoint:GET /api/v1/orders").sort()).toEqual(["backend/src/controllers/orders.ts", "backend/src/routes/orders.ts"]);
  expect(from("page:/orders").sort()).toEqual(["frontend/app/orders/page.tsx", "frontend/lib/api.ts"]);
});

test("a plan item that names a table reaches the migrations that make it", () => {
  const edges = structuralTrace(buildAppMap(dir), dir);
  expect(edges.filter((e) => e.from === "SC2").map((e) => e.to)).toEqual(["table:menu_items"]);
  expect(edges.filter((e) => e.from === "table:menu_items").map((e) => e.to).sort()).toEqual(["db/migrations/0000.sql", "db/migrations/0001.sql"]);
});

test("the handoff facts are the same for the same code, whatever the time or the tests, and change when the code does", () => {
  const a = handoffFacts(buildAppMap(dir));
  const b = handoffFacts(buildAppMap(dir));
  expect(a).toEqual(b);
  expect(a.digest).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(a)).not.toContain("AT-1");
  write("backend/src/controllers/orders.ts", `export const listOrders = async (req, res) => { await pool.query("SELECT id, note FROM orders"); };`);
  expect(handoffFacts(buildAppMap(dir)).digest).not.toBe(a.digest);
});

test("codeFacts: the broken rules by identity, and the digest of the code's facts", async () => {
  const { codeFacts } = await import("./trace.ts");
  write("backend/src/routes/search.ts", "export const s = async (req, res) => { await pool.query(`SELECT id FROM orders WHERE id = '${req.query.id}'`); };");
  const f = codeFacts(dir);
  expect(f.open).toContain("SEC1|function:backend/src/routes/search.ts#s");
  expect(f.digest).toBe(handoffFacts(buildAppMap(dir)).digest);
  rmSync(join(dir, "backend/src/routes/search.ts"));
  expect(codeFacts(dir).open.some((o) => o.startsWith("SEC1|"))).toBe(false);
});
