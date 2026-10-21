import { test, expect } from "bun:test";
import { findLeakPatterns, detectGrowth, runLeakProbe } from "./leaks.ts";

// Patent claim 9: memory-leak detection. Two ways: the code is read for the patterns that leak, and a running app is measured
// while the same routes are called again and again.

const kinds = (code: string, file = "backend/src/x.ts") => findLeakPatterns(file, code).map((p) => p.kind);

test("a list at the top of the file that every request adds to, and nothing ever trims, is reported", () => {
  const p = findLeakPatterns("backend/src/x.ts", `const seen: string[] = [];
app.get("/h", (req, res) => {
  seen.push(req.ip);
  res.send("ok");
});`)[0]!;
  expect(p.kind).toBe("unbounded-collection");
  expect(p.line).toBe(3);
  expect(p.message).toContain("seen");
});

test("the same list is fine when something removes from it or limits its size", () => {
  expect(kinds(`const seen: string[] = [];\napp.get("/h", (req, res) => { seen.push(req.ip); if (seen.length > 100) seen.shift(); });`)).toEqual([]);
  expect(kinds(`const cache = new Map();\napp.get("/h", (req, res) => { cache.set(req.url, 1); setTimeout(() => cache.delete(req.url), 1000); });`)).toEqual([]);
  expect(kinds(`const hits = new Set<string>();\napp.get("/h", (req, res) => { hits.add(req.ip); });\nfunction reset() { hits.clear(); }`)).toEqual([]);
});

test("a list that is only filled while starting up, or only read, is not reported", () => {
  expect(kinds(`const routes: string[] = [];\nroutes.push("/a");\napp.get("/h", (req, res) => { res.json(routes); });`)).toEqual([]);
});

test("a listener added to a long-lived object on every request is reported; one on the request itself is not", () => {
  expect(kinds(`app.get("/s", (req, res) => { bus.on("tick", () => res.write("x")); });`)).toEqual(["listener-per-request"]);
  expect(kinds(`app.get("/s", (req, res) => { req.on("close", () => done()); res.on("finish", () => done()); });`)).toEqual([]);
  expect(kinds(`app.get("/s", (req, res) => { const f = () => 1; bus.on("tick", f); req.on("close", () => bus.off("tick", f)); });`)).toEqual([]);
});

test("a timer started on every call with nothing to stop it is reported", () => {
  expect(kinds(`app.get("/p", (req, res) => { setInterval(() => poll(), 1000); res.end(); });`)).toEqual(["timer-per-call"]);
  expect(kinds(`setInterval(() => poll(), 1000);`)).toEqual([]);
  expect(kinds(`app.get("/p", (req, res) => { const t = setInterval(() => poll(), 1000); req.on("close", () => clearInterval(t)); });`)).toEqual([]);
});

test("a new connection pool created inside a request handler is reported", () => {
  expect(kinds(`app.get("/d", async (req, res) => { const pool = new Pool({ connectionString: url }); res.json((await pool.query("select 1")).rows); });`)).toEqual(["connection-per-request"]);
  expect(kinds(`const pool = new Pool({ connectionString: url });\napp.get("/d", async (req, res) => { res.json((await pool.query("select 1")).rows); });`)).toEqual([]);
});

test("a connection taken from the pool and never given back is reported; try/finally with release is fine", () => {
  expect(kinds(`async function f() { const client = await pool.connect(); await client.query("select 1"); }`)).toEqual(["connection-not-released"]);
  expect(kinds(`async function f() { const client = await pool.connect(); try { await client.query("select 1"); } finally { client.release(); } }`)).toEqual([]);
});

test("tests and non-code give nothing", () => {
  expect(findLeakPatterns("a.test.ts", `const s = []; app.get("/", (req, res) => { s.push(1); });`)).toEqual([]);
  expect(findLeakPatterns("README.md", "x")).toEqual([]);
});

// ── measuring ───────────────────────────────────────────────────────────────

const series = (f: (i: number) => number, n = 12, step = 50) => Array.from({ length: n }, (_, i) => ({ requests: (i + 1) * step, mb: f(i) }));

test("memory that rises steadily with the number of requests is a leak", () => {
  const v = detectGrowth(series((i) => 80 + i * 2.5));
  expect(v.leak).toBe(true);
  expect(v.slopeMbPer1000).toBeCloseTo(50, 0);
  expect(v.r2).toBeGreaterThan(0.95);
});

test("memory that stays level, with ordinary noise, is not a leak", () => {
  const noise = [0.3, -0.2, 0.4, -0.5, 0.1, 0.2, -0.3, 0.5, -0.1, 0.0, 0.2, -0.4];
  const v = detectGrowth(series((i) => 80 + noise[i]!));
  expect(v.leak).toBe(false);
});

test("memory that climbs and is then collected, over and over, is not a leak", () => {
  const v = detectGrowth(series((i) => 80 + (i % 4) * 6));
  expect(v.leak).toBe(false);
});

test("a rise during warm-up and then a flat line is not a leak", () => {
  const v = detectGrowth(series((i) => (i < 3 ? 60 + i * 10 : 90 + (i % 2) * 0.2)));
  expect(v.leak).toBe(false);
});

test("too few measurements give no verdict instead of a guess", () => {
  const v = detectGrowth(series((i) => 80 + i, 4));
  expect(v.leak).toBe(false);
  expect(v.reason).toContain("not enough");
});

test("the probe calls the routes, reads memory after every round, and reports the verdict and the timings", async () => {
  let requests = 0;
  let clock = 0; // a virtual clock, so the timings are exact
  const fetchFn = async (url: string) => {
    requests++;
    clock += url.endsWith("/slow") ? 6 : 1;
    return new Response("ok", { status: url.endsWith("/bad") ? 500 : 200 });
  };
  const leaky = await runLeakProbe({ baseUrl: "http://x", routes: ["/a", "/slow", "/bad"], rounds: 8, requestsPerRound: 12, fetchFn: fetchFn as any, now: () => clock, readMemoryMb: async () => 50 + requests * 0.02 });
  expect(leaky.samples.length).toBe(8);
  expect(leaky.samples[7]!.requests).toBe(96);
  expect(leaky.verdict.leak).toBe(true);
  expect(leaky.timings["/slow"]!.p50).toBe(6);
  expect(leaky.timings["/a"]!.p50).toBe(1);
  expect(leaky.timings["/bad"]!.errors).toBe(32);
  expect(leaky.timings["/a"]!.count).toBe(32);
  const steady = await runLeakProbe({ baseUrl: "http://x", routes: ["/a"], rounds: 8, requestsPerRound: 5, fetchFn: fetchFn as any, now: () => clock, readMemoryMb: async () => 50 });
  expect(steady.verdict.leak).toBe(false);
});

test("the probe only makes GET requests", async () => {
  const methods: string[] = [];
  await runLeakProbe({ baseUrl: "http://x", routes: ["/a"], rounds: 2, requestsPerRound: 3, fetchFn: (async (_u: string, init?: RequestInit) => (methods.push(init?.method ?? "GET"), new Response("ok"))) as any, readMemoryMb: async () => 1 });
  expect(new Set(methods)).toEqual(new Set(["GET"]));
});
