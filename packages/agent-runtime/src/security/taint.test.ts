import { test, expect } from "bun:test";
import { analyzeTaint } from "./taint.ts";

// Patent claim 8: taint analysis. Data from the request is followed through the code; a finding is reported only where it
// reaches a dangerous call without passing through a check.

const kinds = (code: string, file = "backend/src/routes/x.ts") => analyzeTaint(file, code).map((f) => f.kind);
const first = (code: string) => analyzeTaint("backend/src/routes/x.ts", code)[0]!;

test("request data joined into SQL text is reported, with where it came from and where it landed", () => {
  const f = first(`app.get("/u/:id", async (req, res) => {
  const id = req.params.id;
  const r = await db.query("SELECT * FROM users WHERE id = " + id);
  res.json(r.rows);
});`);
  expect(f.kind).toBe("sql-injection");
  expect(f.cwe).toBe("CWE-89");
  expect(f.source.description).toContain("req.params.id");
  expect(f.source.line).toBe(2);
  expect(f.sink.line).toBe(3);
  expect(f.path).toEqual(["id"]);
  expect(f.message).toContain("line 2");
  expect(f.message).toContain("line 3");
});

test("the data is followed through a template string and a second variable", () => {
  const f = first(`app.get("/s", async (req, res) => {
  const name = req.query.name;
  const q = \`SELECT * FROM t WHERE name = '\${name}'\`;
  await pool.query(q);
});`);
  expect(f.kind).toBe("sql-injection");
  expect(f.path).toEqual(["name", "q"]);
});

test("a parameterised query is safe: the request value goes in the values, not the text", () => {
  expect(kinds(`app.get("/u/:id", async (req, res) => { await db.query("SELECT * FROM users WHERE id = $1", [req.params.id]); });`)).toEqual([]);
});

test("a value that passes through a number conversion or a schema check is no longer untrusted", () => {
  expect(kinds(`app.get("/u/:id", async (req, res) => { const id = Number(req.params.id); await db.query("SELECT * FROM u WHERE id = " + id); });`)).toEqual([]);
  expect(kinds(`app.post("/u", async (req, res) => { const body = schema.parse(req.body); await db.query("INSERT INTO u VALUES ('" + body.name + "')"); });`)).toEqual([]);
  expect(kinds(`app.get("/u", async (req, res) => { const n = parseInt(req.query.n as string, 10); await db.query("SELECT * FROM u LIMIT " + n); });`)).toEqual([]);
});

test("a destructured field from the body that reaches a shell command is reported", () => {
  const f = first(`app.post("/c", (req, res) => { const { name } = req.body; exec("convert " + name + ".png"); });`);
  expect(f.kind).toBe("command-injection");
  expect(f.severity).toBe("CRITICAL");
});

test("a fixed command is not reported, and neither is a regular expression's exec", () => {
  expect(kinds(`app.get("/", (req, res) => { exec("ls -la"); const m = pattern.exec(req.query.q as string); });`)).toEqual([]);
});

test("the data is followed into a helper function in the same file", () => {
  const f = first(`function findUser(id: string) {
  return db.query("SELECT * FROM users WHERE id = " + id);
}
app.get("/u/:id", async (req, res) => {
  res.json(await findUser(req.params.id));
});`);
  expect(f.kind).toBe("sql-injection");
  expect(f.sink.line).toBe(2);
  expect(f.source.description).toContain("req.params.id");
});

test("a helper that returns request data hands the taint to its caller", () => {
  expect(kinds(`const pick = (req: any) => req.query.target;
app.get("/go", (req, res) => { res.redirect(pick(req)); });`)).toEqual(["open-redirect"]);
});

test("file paths from the request are reported unless reduced to a plain file name", () => {
  expect(kinds(`app.get("/f", (req, res) => { res.sendFile(path.join(DIR, req.params.name)); });`)).toEqual(["path-traversal"]);
  expect(kinds(`app.get("/f", (req, res) => { fs.readFile(req.query.file as string, cb); });`)).toEqual(["path-traversal"]);
  expect(kinds(`app.get("/f", (req, res) => { res.sendFile(path.join(DIR, path.basename(req.params.name))); });`)).toEqual([]);
});

test("a URL taken from the request and fetched is reported as server-side request forgery", () => {
  const f = first(`app.post("/p", async (req, res) => { const url = req.body.url; const r = await fetch(url); res.json(await r.json()); });`);
  expect(f.kind).toBe("ssrf");
  expect(f.cwe).toBe("CWE-918");
});

test("eval and new Function on request data are reported as code injection", () => {
  expect(kinds(`app.post("/e", (req, res) => { eval(req.body.code); });`)).toEqual(["code-injection"]);
  expect(kinds(`app.post("/e", (req, res) => { const f = new Function("a", req.body.src); });`)).toEqual(["code-injection"]);
});

test("HTML built from request data and sent back is reported as cross-site scripting", () => {
  expect(kinds(`app.get("/h", (req, res) => { res.send("<h1>Hello " + req.query.name + "</h1>"); });`)).toEqual(["xss"]);
  expect(kinds(`app.get("/h", (req, res) => { res.json({ name: req.query.name }); });`)).toEqual([]);
});

test("a Next.js route handler: data read from the request body reaches a query", () => {
  const f = first(`export async function POST(request: Request) {
  const { sql } = await request.json();
  return Response.json(await db.query(sql));
}`);
  expect(f.kind).toBe("sql-injection");
  expect(f.source.description).toContain("request.json()");
});

test("data set to a safe value again before the dangerous call is no longer untrusted", () => {
  expect(kinds(`app.get("/", async (req, res) => { let id = req.params.id; id = "42"; await db.query("SELECT * FROM t WHERE id = " + id); });`)).toEqual([]);
});

test("taint carried in either branch of an if still counts afterwards", () => {
  expect(kinds(`app.get("/", async (req, res) => { let id = "1"; if (req.query.a) { id = req.query.a as string; } await db.query("SELECT * FROM t WHERE id = " + id); });`)).toEqual(["sql-injection"]);
});

test("values the server set itself (the signed-in user) are trusted, request fields are not", () => {
  expect(kinds(`app.get("/", async (req, res) => { await db.query("SELECT * FROM t WHERE owner = '" + req.user.id + "'"); });`)).toEqual([]);
});

test("one dangerous call is reported once even if reached several ways, and the same code twice gives the same result", () => {
  const code = `app.get("/", async (req, res) => { const a = req.query.a; const b = a; await db.query("SELECT " + a + b); });`;
  expect(analyzeTaint("a.ts", code).length).toBe(1);
  expect(JSON.stringify(analyzeTaint("a.ts", code))).toBe(JSON.stringify(analyzeTaint("a.ts", code)));
});

test("files that are not code, tests, or that fail to parse give nothing instead of an error", () => {
  expect(analyzeTaint("README.md", "req.params.id")).toEqual([]);
  expect(analyzeTaint("a.test.ts", `db.query("x" + req.params.id)`)).toEqual([]);
  expect(() => analyzeTaint("a.ts", "const = = ;;; (((")).not.toThrow();
});

// Found by running the analysis over 73 real generated apps: both of its first reports were false alarms.
test("a value checked against an allowed list is trusted inside that branch", () => {
  expect(kinds(`app.get("/", async (req, res) => {
  let dir = "DESC";
  const s = req.query.sortOrder;
  if (typeof s === "string" && ["asc", "desc"].includes(s.toLowerCase())) { dir = s.toUpperCase(); }
  await db.query("SELECT * FROM t ORDER BY id " + dir);
});`)).toEqual([]);
  expect(kinds(`const ALLOWED = new Set(["a", "b"]);
app.get("/", async (req, res) => { const c = req.query.col as string; if (ALLOWED.has(c)) { await db.query("SELECT " + c + " FROM t"); } });`)).toEqual([]);
});

test("an early exit when the value is NOT in the allowed list makes it trusted afterwards", () => {
  expect(kinds(`app.get("/", async (req, res) => {
  const c = req.query.col as string;
  if (!["a", "b"].includes(c)) { return res.status(400).end(); }
  await db.query("SELECT " + c + " FROM t");
});`)).toEqual([]);
});

test("the allowed-list rule does not excuse a different value, or a list the caller controls", () => {
  expect(kinds(`app.get("/", async (req, res) => {
  const a = req.query.a as string; const b = req.query.b as string;
  if (["x", "y"].includes(a)) { await db.query("SELECT " + b + " FROM t"); }
});`)).toEqual(["sql-injection"]);
  expect(kinds(`app.get("/", async (req, res) => { const a = req.query.a as string; if ((req.body.list as string[]).includes(a)) { await db.query("SELECT " + a); } });`)).toEqual(["sql-injection"]);
});

test("request data added to the path or query of a URL on a fixed host is not server-side request forgery", () => {
  expect(kinds("const API_URL = process.env.API_URL; app.get('/p', async (req, res) => { const u = `${API_URL}/v1/items${req.query.q}`; await fetch(u); });")).toEqual([]);
  expect(kinds(`app.get("/p", async (req, res) => { await fetch("https://api.example.com/x?q=" + req.query.q); });`)).toEqual([]);
});

test("request data that decides the host is still reported", () => {
  expect(kinds("app.get('/p', async (req, res) => { await fetch(`${req.query.host}/x`); });")).toEqual(["ssrf"]);
  expect(kinds("app.get('/p', async (req, res) => { await fetch(`https://${req.query.host}/x`); });")).toEqual(["ssrf"]);
});
