import { test, expect } from "bun:test";
import ts from "typescript";
import { MUTATIONS, plantDefect, type Mutation } from "./mutations.ts";

// Patent claim 4: the checkers are trained against defects. This planter puts known defects into copies of generated code, at
// five levels from obvious to subtle, so that a checker's ability to find them can be measured.

const by = (op: string): Mutation => MUTATIONS.find((m) => m.operator === op)!;
const parses = (code: string) => ((ts.createSourceFile("x.ts", code, ts.ScriptTarget.Latest, true) as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length === 0);

const ROUTES = `import { Router } from "express";
const router = Router();
router.get("/items/:id", async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const rows = await db.query("SELECT * FROM items WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
  res.json(rows.rows);
});
router.post("/items", async (req, res) => {
  const body = schema.parse(req.body);
  try {
    await db.query("INSERT INTO items (name) VALUES ($1)", [body.name]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "failed" });
  }
  const role = req.user.role;
  for (let i = 0; i < body.tags.length; i++) { tag(body.tags[i]); }
  res.status(201).end();
});
const digest = crypto.createHash("sha256").update("x").digest("hex");
const one = await db.query("SELECT * FROM items WHERE id = $1", [id]);
export default router;
`;

test("there are mutations at all five levels, each with a unique name and a hint for recognising a finding about it", () => {
  expect(new Set(MUTATIONS.map((m) => m.level))).toEqual(new Set([1, 2, 3, 4, 5]));
  expect(new Set(MUTATIONS.map((m) => m.operator)).size).toBe(MUTATIONS.length);
  for (const m of MUTATIONS) {
    expect(m.hint).toBeInstanceOf(RegExp);
    expect(m.description.length).toBeGreaterThan(10);
  }
});

test("every mutation that applies changes the code, keeps it valid, and reports the line it changed", () => {
  for (const m of MUTATIONS) {
    expect(m.applicable(ROUTES)).toBe(true);
    const out = m.apply(ROUTES)!;
    expect(out.source).not.toBe(ROUTES);
    expect(parses(out.source)).toBe(true);
    expect(out.line).toBeGreaterThan(0);
    expect(out.source.split("\n").length).toBeGreaterThanOrEqual(1);
  }
});

test("a mutation does not apply to code it has nothing to change", () => {
  const plain = `export const add = (a: number, b: number) => a + b;\n`;
  for (const op of ["sql-concat", "remove-auth-check", "off-by-one", "swallow-error", "missing-validation", "trust-client-role", "drop-ownership-filter", "weak-hash", "leak-collection"]) {
    expect(by(op).applicable(plain)).toBe(false);
    expect(by(op).apply(plain)).toBeNull();
  }
});

test("the parameterised query becomes one built from text", () => {
  const out = by("sql-concat").apply(ROUTES)!;
  expect(out.after).toContain('"SELECT * FROM items WHERE id = " + id');
  expect(out.after).not.toContain("$1");
});

test("the sign-in check is removed from the route, and the rest of the route is untouched", () => {
  const out = by("remove-auth-check").apply(ROUTES)!;
  expect(out.source).not.toContain("Unauthorized");
  expect(out.source).toContain('router.get("/items/:id"');
  expect(out.source).toContain("SELECT * FROM items WHERE id = $1 AND user_id = $2");
  expect(out.line).toBe(4);
});

test("the loop bound is pushed one past the end, errors are swallowed, validation is skipped, the role comes from the client", () => {
  expect(by("off-by-one").apply(ROUTES)!.after).toContain("i <= body.tags.length");
  expect(by("swallow-error").apply(ROUTES)!.source).not.toContain("console.error(err)");
  expect(by("missing-validation").apply(ROUTES)!.after).toContain("req.body");
  expect(by("missing-validation").apply(ROUTES)!.source).not.toContain("schema.parse(req.body)");
  expect(by("trust-client-role").apply(ROUTES)!.after).toContain("req.body.role");
  expect(by("drop-ownership-filter").apply(ROUTES)!.source).not.toContain("AND user_id");
  expect(by("weak-hash").apply(ROUTES)!.after).toContain('"md5"');
});

test("a collection that grows on every request is planted at the top and in the first handler", () => {
  const out = by("leak-collection").apply(ROUTES)!;
  expect(out.source).toContain("__recentRequests: string[] = []");
  expect(out.source).toContain("__recentRequests.push(");
});

test("planting returns the changed code and a record of what was planted, with a stable id", () => {
  const a = plantDefect("backend/src/routes/items.ts", ROUTES, by("remove-auth-check"))!;
  const b = plantDefect("backend/src/routes/items.ts", ROUTES, by("remove-auth-check"))!;
  expect(a.defect.id).toBe(b.defect.id);
  expect(a.defect).toMatchObject({ operator: "remove-auth-check", level: 3, file: "backend/src/routes/items.ts", line: 4 });
  expect(a.defect.before).toContain("if (!req.user)");
  expect(plantDefect("backend/src/routes/items.ts", `export const x = 1;\n`, by("remove-auth-check"))).toBeNull();
});

test("the original is never touched: planting works on the text it is given", () => {
  const copy = `${ROUTES}`;
  plantDefect("a.ts", copy, by("sql-concat"));
  expect(copy).toBe(ROUTES);
});
