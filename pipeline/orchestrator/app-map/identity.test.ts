import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildAppMap, type AppMap } from "./index.ts";
import { findingIdentity, placeOf, recordSent, sentBefore } from "./identity.ts";

// 2026-10-30 (understanding plan, step 4): a finding is identified by what it is about in the app — the rule or plan item it
// cites and the place in the map its file and line fall in (an endpoint, a table, a page) — not by its words. Brewline 3's
// item-name finding came back 18 times in new words; the system could not tell a repeat from a new fact, or a new fact from
// a repeat (the 14:42 fix had landed, and the later reports were about other code under the same rule).

let dir = "";
let map: AppMap;
const write = (rel: string, text: string) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "identity-"));
  write("db/migrations/0000.sql", `CREATE TABLE "menu_items" ("id" uuid PRIMARY KEY, "name" text NOT NULL, "price" numeric NOT NULL);
CREATE TABLE "orders" ("id" uuid PRIMARY KEY);
CREATE TABLE "order_items" ("id" uuid PRIMARY KEY, "order_id" uuid REFERENCES "orders"("id"), "menu_item_id" uuid REFERENCES "menu_items"("id"), "quantity" integer);`);
  write("backend/src/app.ts", `import orders from "./orders";\nconst app = express();\napp.use("/api/v1/orders", orders);`);
  write("backend/src/orders.ts", `const router = Router();
router.get("/:id", async (req, res) => {
  const id = req.params.id;
  const rows = await pool.query("SELECT oi.id, mi.name FROM order_items oi JOIN menu_items mi ON mi.id = oi.menu_item_id WHERE oi.order_id = $1", [id]);
  res.json(rows);
});
router.post("/", async (req, res) => {
  await pool.query("INSERT INTO orders (id) VALUES ($1)", [req.body.id]);
});
export default router;`);
  write("frontend/app/orders/page.tsx", `export default function Orders() { fetch("/api/v1/orders/1"); return null; }`);
  map = buildAppMap(dir);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("a line inside a handler is the endpoint; a migration finding is the table it names; a page file is the page", () => {
  expect(placeOf(map, "backend/src/orders.ts", 3)).toEqual({ kind: "endpoint", key: "GET /api/v1/orders/:id" });
  expect(placeOf(map, "backend/src/orders.ts", 8)).toEqual({ kind: "endpoint", key: "POST /api/v1/orders" });
  expect(placeOf(map, "db/migrations/0000.sql", 1, "order_items.menu_item_id cascades")).toEqual({ kind: "table", key: "order_items" });
  expect(placeOf(map, "frontend/app/orders/page.tsx", 1)).toEqual({ kind: "page", key: "/orders" });
  expect(placeOf(map, "backend/src/unknown.ts", 4)).toEqual({ kind: "file", key: "backend/src/unknown.ts" });
});

test("the same fact in other words, from another reviewer or from the map's own check, has one identity", () => {
  const a = findingIdentity(map, { file: "backend/src/orders.ts", issue: "backend/src/orders.ts:4 — [logic/HIGH] [INT1] the order shows the item's current name" });
  const b = findingIdentity(map, { file: "backend/src/orders.ts", issue: "backend/src/orders.ts:5 — [security/MEDIUM] [INT1] Order history joins menu_items, so a renamed drink rewrites old receipts" });
  const c = findingIdentity(map, { file: "backend/src/orders.ts", issue: "[map-rule INT1] backend/src/orders.ts:4 — (inline) reads the name from menu_items.name, the current value" });
  expect(a).toBe("INT1|endpoint:GET /api/v1/orders/:id");
  expect(b).toBe(a);
  expect(c).toBe(a);
});

test("the same rule at another place, or another rule at the same place, is a different fact", () => {
  const read = findingIdentity(map, { file: "backend/src/orders.ts", issue: "backend/src/orders.ts:4 — [INT1] reads the current name" });
  expect(findingIdentity(map, { file: "backend/src/orders.ts", issue: "backend/src/orders.ts:8 — [INT1] the insert writes no name" })).not.toBe(read);
  expect(findingIdentity(map, { file: "backend/src/orders.ts", issue: "backend/src/orders.ts:4 — [SEC3] any signed-in user reads any order" })).not.toBe(read);
});

test("a finding sent to a builder before is known when it comes back, with when and to whom", () => {
  recordSent(dir, [{ identity: "INT1|endpoint:GET /api/v1/orders/:id", owner: "shubham", text: "reads the current name" }], "2026-10-25T14:20:00Z");
  expect(sentBefore(dir, "INT1|endpoint:GET /api/v1/orders/:id")).toMatchObject({ owner: "shubham", sentAt: "2026-10-25T14:20:00Z" });
  expect(sentBefore(dir, "INT1|table:order_items")).toBeNull();
});

test("a line inside a helper the handlers call is that helper", () => {
  const d = mkdtempSync(join(tmpdir(), "identity-fn-"));
  mkdirSync(join(d, "backend", "src"), { recursive: true });
  writeFileSync(join(d, "backend", "src", "app.ts"), `const app = express();
function validateSlot(t: string) {
  const m = Number(t);
  return m > 480;
}
app.post("/api/v1/orders", async (req, res) => { validateSlot(req.body.t); });`);
  const m = buildAppMap(d);
  expect(placeOf(m, "backend/src/app.ts", 3)).toEqual({ kind: "function", key: "backend/src/app.ts#validateSlot" });
  rmSync(d, { recursive: true, force: true });
});
