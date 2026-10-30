import { test, expect } from "bun:test";
import { applyMigrations, queryFacts } from "./sql.ts";

// 2026-10-30 (understanding plan, step 2): the app map reads the database from the migrations and every query from its SQL
// text — by code, not by a model. These are the shapes Brewline 3's generated code really has.

const M0 = `CREATE TABLE IF NOT EXISTS "menu_items" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "price" numeric(10,2) NOT NULL
);
CREATE TABLE IF NOT EXISTS "order_items" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
    "menu_item_id" uuid NOT NULL REFERENCES "menu_items"("id") ON DELETE RESTRICT,
    "price_at_time" numeric(10,2) NOT NULL -- the price when ordered
);
CREATE INDEX IF NOT EXISTS "order_items_order_id_idx" ON "order_items" ("order_id");`;
const M1 = `ALTER TABLE "order_items" ADD COLUMN "name_at_time" text NOT NULL DEFAULT '';`;
const M2 = `ALTER TABLE "order_items" ALTER COLUMN "menu_item_id" DROP NOT NULL;
ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_menu_item_id_fkey";
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE SET NULL;`;

test("the migrations, applied in order, give the tables, columns, nullability and foreign keys as they end up", () => {
  const db = applyMigrations([{ file: "db/migrations/0000_initial.sql", sql: M0 }, { file: "db/migrations/0001_fix.sql", sql: M1 }, { file: "db/migrations/0002_fix.sql", sql: M2 }]);
  expect(Object.keys(db.tables).sort()).toEqual(["menu_items", "order_items"]);
  const oi = db.tables.order_items!;
  expect(Object.keys(oi.columns)).toEqual(["id", "order_id", "menu_item_id", "price_at_time", "name_at_time"]);
  expect(oi.columns.name_at_time).toMatchObject({ type: "text", notNull: true, addedIn: "db/migrations/0001_fix.sql" });
  expect(oi.columns.menu_item_id).toMatchObject({ notNull: false, references: { table: "menu_items", column: "id", onDelete: "SET NULL" } });
  expect(oi.columns.order_id!.references).toEqual({ table: "orders", column: "id", onDelete: "CASCADE" });
  expect(db.unread).toEqual([]);
});

test("a statement the reader does not understand is listed, never guessed", () => {
  const db = applyMigrations([{ file: "m.sql", sql: `CREATE TABLE "a" ("id" uuid);\nCREATE TRIGGER t AFTER INSERT ON "a" FOR EACH ROW EXECUTE FUNCTION f();` }]);
  expect(Object.keys(db.tables)).toEqual(["a"]);
  expect(db.unread).toEqual([{ file: "m.sql", statement: expect.stringContaining("CREATE TRIGGER") }]);
});

test("an INSERT writes the columns it names", () => {
  const q = queryFacts("INSERT INTO order_items (order_id, menu_item_id, quantity, price_at_time, name_at_time) VALUES ($1, $2, $3, $4, $5) RETURNING id");
  expect(q.kind).toBe("insert");
  expect(q.writes).toEqual(["order_items.order_id", "order_items.menu_item_id", "order_items.quantity", "order_items.price_at_time", "order_items.name_at_time"]);
});

test("a SELECT names the tables with their aliases and join types, and each column it reads — a fallback included", () => {
  const q = queryFacts(`
      SELECT oi.id, oi.order_id, COALESCE(NULLIF(oi.name_at_time, ''), mi.name, 'Unknown Item') AS name, oi.quantity
      FROM order_items oi
      LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
      WHERE oi.order_id = ANY($1::uuid[])`);
  expect(q.kind).toBe("select");
  expect(q.tables).toEqual([{ table: "order_items", alias: "oi", join: "from" }, { table: "menu_items", alias: "mi", join: "left" }]);
  expect(q.reads).toEqual(expect.arrayContaining(["order_items.id", "order_items.name_at_time", "menu_items.name", "order_items.quantity"]));
  expect(q.outputs).toContainEqual({ as: "name", from: ["order_items.name_at_time", "menu_items.name"] });
  expect(q.filters).toEqual(expect.arrayContaining(["order_items.menu_item_id", "menu_items.id", "order_items.order_id"]));
});

test("an inner JOIN is told apart from a LEFT JOIN", () => {
  const q = queryFacts("SELECT mi.name FROM order_items oi JOIN menu_items mi ON oi.menu_item_id = mi.id");
  expect(q.tables[1]).toEqual({ table: "menu_items", alias: "mi", join: "inner" });
  expect(q.outputs).toContainEqual({ as: "name", from: ["menu_items.name"] });
});

test("UPDATE writes its SET columns; DELETE names its table; an unqualified column belongs to the only table", () => {
  const u = queryFacts(`UPDATE menu_items SET name = $1, price = $2, updated_at = now() WHERE id = $3 RETURNING *`);
  expect(u).toMatchObject({ kind: "update", writes: ["menu_items.name", "menu_items.price", "menu_items.updated_at"], filters: ["menu_items.id"] });
  expect(queryFacts("DELETE FROM menu_items WHERE id = $1 RETURNING id")).toMatchObject({ kind: "delete", deletes: ["menu_items"], filters: ["menu_items.id"] });
});

test("SQL built from values in the text is marked", () => {
  expect(queryFacts("SELECT * FROM users WHERE status = '${status}'", { dynamic: true }).builtFromValues).toBe(true);
  expect(queryFacts("SELECT * FROM users WHERE status = $1").builtFromValues).toBe(false);
});

// 2026-10-30 (the map on Brewline 3's real code): a row lock and a transaction are facts, not columns.
test("FOR UPDATE is a row lock, not a column; BEGIN, COMMIT and ROLLBACK are a transaction", () => {
  const q = queryFacts("SELECT id, name, price, in_stock FROM menu_items WHERE id = ANY($1::uuid[]) FOR UPDATE");
  expect(q.locks).toBe(true);
  expect(q.filters).toEqual(["menu_items.id"]);
  expect(queryFacts("SELECT id FROM menu_items").locks).toBe(false);
  expect(queryFacts("BEGIN")).toMatchObject({ kind: "transaction", transaction: "begin" });
  expect(queryFacts("COMMIT")).toMatchObject({ kind: "transaction", transaction: "commit" });
  expect(queryFacts("ROLLBACK")).toMatchObject({ kind: "transaction", transaction: "rollback" });
});

// 2026-10-30 (the map on six other builds): data changes in migrations change no table; a DO block is one statement;
// AT TIME ZONE and EXTRACT are not columns; a WITH name is not a database table.
test("data changes in migrations are passed over; a DO block is one statement the map lists, not cut apart", () => {
  const db = applyMigrations([{ file: "m.sql", sql: `CREATE TABLE "plants" ("id" uuid, "name" text);
UPDATE plants SET name = 'x' FROM other WHERE other.id = plants.id;
WITH kept AS (SELECT MIN(id) AS id FROM plants GROUP BY name) DELETE FROM plants WHERE id NOT IN (SELECT id FROM kept);
DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT 1 LOOP NULL; END LOOP; END $$;
ALTER TABLE "plants" ADD COLUMN "notes" text;` }]);
  expect(Object.keys(db.tables.plants!.columns)).toEqual(["id", "name", "notes"]);
  expect(db.unread).toEqual([{ file: "m.sql", statement: expect.stringMatching(/^DO \$\$/) }]);
});

test("AT TIME ZONE and EXTRACT are not columns; a WITH name is not a database table", () => {
  const q = queryFacts("SELECT DATE(i.created_at AT TIME ZONE 'Asia/Kolkata') AS day, EXTRACT(EPOCH FROM i.due_date) AS due FROM invoices i");
  expect(q.reads.sort()).toEqual(["invoices.created_at", "invoices.due_date"]);
  expect(q.unresolved).toEqual([]);
  const c = queryFacts("WITH peak_usage AS (SELECT gear_id, COUNT(*) AS n FROM bookings GROUP BY gear_id) SELECT g.name, p.n FROM gear g JOIN peak_usage p ON p.gear_id = g.id");
  expect(c.ctes).toEqual(["peak_usage"]);
});
