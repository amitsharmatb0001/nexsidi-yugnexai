import { test, expect } from "bun:test";
import { analyzeComplexity, type FunctionComplexity } from "./complexity.ts";

// Patent claim 9: the performance checker estimates how running time grows with the amount of data (Big-O), from the code.

const fn = (code: string, name: string, file = "backend/src/x.ts"): FunctionComplexity => analyzeComplexity(file, code).find((f) => f.name === name)!;

test("a function with no loops is constant time", () => {
  expect(fn(`function add(a: number, b: number) { return a + b; }`, "add").estimate).toBe("O(1)");
});

test("one loop over data is linear; two nested loops are quadratic; three are cubic", () => {
  expect(fn(`function f(xs: number[]) { let s = 0; for (const x of xs) s += x; return s; }`, "f").estimate).toBe("O(n)");
  expect(fn(`function g(xs: number[]) { for (const a of xs) for (const b of xs) if (a === b) return true; }`, "g").estimate).toBe("O(n²)");
  expect(fn(`function h(xs: number[]) { for (const a of xs) for (const b of xs) for (const c of xs) if (a + b === c) return 1; }`, "h").estimate).toBe("O(n³)");
});

test("array methods that take a function count as loops, and nest like loops", () => {
  expect(fn(`const f = (xs: number[]) => xs.map((x) => x * 2);`, "f").estimate).toBe("O(n)");
  expect(fn(`const g = (xs: number[], ys: number[]) => xs.filter((x) => ys.some((y) => y === x));`, "g").estimate).toBe("O(n²)");
});

test("sorting is n log n, and a loop around a sort is above that", () => {
  expect(fn(`const f = (xs: number[]) => xs.sort((a, b) => a - b);`, "f").estimate).toBe("O(n log n)");
  expect(fn(`function g(groups: number[][]) { for (const x of groups) x.sort(); }`, "g").estimate).toBe("O(n² log n)");
});

test("loops with a small fixed bound do not count as growing with the data", () => {
  expect(fn(`function f() { for (let i = 0; i < 10; i++) { work(i); } }`, "f").estimate).toBe("O(1)");
  expect(fn(`function g(xs: number[]) { for (let i = 0; i < 3; i++) for (const x of xs) work(x); }`, "g").estimate).toBe("O(n)");
});

test("a linear search inside a loop makes the function quadratic, with the reason", () => {
  const f = fn(`function dedupe(xs: string[]) { const out: string[] = []; for (const x of xs) { if (!out.includes(x)) out.push(x); } return out; }`, "dedupe");
  expect(f.estimate).toBe("O(n²)");
  expect(f.reasons.join(" ")).toContain("includes");
});

test("a database or network call inside a loop is reported as one call per item", () => {
  const f = fn(`async function load(ids: string[]) { const rows = []; for (const id of ids) { rows.push(await db.query("SELECT * FROM t WHERE id = $1", [id])); } return rows; }`, "load");
  expect(f.callsInLoop.length).toBe(1);
  expect(f.callsInLoop[0]!.call).toContain("db.query");
  expect(f.callsInLoop[0]!.line).toBe(1);
  expect(fn(`async function ok(ids: string[]) { return db.query("SELECT * FROM t WHERE id = ANY($1)", [ids]); }`, "ok").callsInLoop).toEqual([]);
});

test("a call inside an array method's callback counts as inside a loop too", () => {
  const f = fn(`async function load(ids: string[]) { return Promise.all(ids.map((id) => fetch("/api/" + id))); }`, "load");
  expect(f.callsInLoop.map((c) => c.call)).toEqual(["fetch"]);
});

test("recursion is noted, and two self-calls with no cache is flagged as possibly exponential", () => {
  const fact = fn(`function fact(n: number): number { return n <= 1 ? 1 : n * fact(n - 1); }`, "fact");
  expect(fact.recursive).toBe(true);
  expect(fact.estimate).toBe("O(n)");
  const fib = fn(`function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2); }`, "fib");
  expect(fib.estimate).toBe("O(2^n)");
});

test("route handlers are named by method and path, and nested functions are reported separately", () => {
  const out = analyzeComplexity("backend/src/routes.ts", `app.get("/items", async (req, res) => { const all = await db.query("select 1"); for (const a of all.rows) for (const b of all.rows) check(a, b); res.json(all.rows); });
function helper() { return 1; }`);
  expect(out.map((f) => f.name).sort()).toEqual(["GET /items", "helper"]);
  expect(out.find((f) => f.name === "GET /items")!.estimate).toBe("O(n²)");
});

test("only functions that are slow or call out per item are worth listing when asked for the concerns", () => {
  const out = analyzeComplexity("a.ts", `function a() { return 1; }
function b(xs: number[]) { for (const x of xs) for (const y of xs) f(x, y); }
async function c(xs: number[]) { for (const x of xs) await db.query("q", [x]); }`);
  const names = analyzeComplexity("a.ts", `function a() { return 1; }
function b(xs: number[]) { for (const x of xs) for (const y of xs) f(x, y); }
async function c(xs: number[]) { for (const x of xs) await db.query("q", [x]); }`, { onlyConcerns: true }).map((f) => f.name);
  expect(out.length).toBe(3);
  expect(names).toEqual(["b", "c"]);
});

test("test files, non-code and broken code give nothing instead of an error", () => {
  expect(analyzeComplexity("a.test.ts", "function f(xs){ for (const a of xs) for (const b of xs) g(a,b) }")).toEqual([]);
  expect(analyzeComplexity("README.md", "for")).toEqual([]);
  expect(() => analyzeComplexity("a.ts", "function ((( {{")).not.toThrow();
});

// Found by running the analysis over 2,707 real functions: a seed loop over five fixed rows was reported as one query per item.
test("a loop over a small fixed list defined in the function does not grow with the data", () => {
  const f = fn(`async function seed() { const defaults = [{ a: 1 }, { a: 2 }, { a: 3 }]; for (const d of defaults) { await pool.query("INSERT INTO t VALUES ($1)", [d.a]); } }`, "seed");
  expect(f.estimate).toBe("O(1)");
  expect(f.callsInLoop).toEqual([]);
  expect(fn(`function g() { const ids = [1, 2, 3]; return ids.map((i) => ids.map((j) => i + j)); }`, "g").estimate).toBe("O(1)");
});

test("a list that comes from outside the function still counts", () => {
  expect(fn(`async function seed(defaults: any[]) { for (const d of defaults) { await pool.query("INSERT INTO t VALUES ($1)", [d.a]); } }`, "seed").callsInLoop.length).toBe(1);
});

test("React page components are labelled as components, so a reader can weigh a nested list on screen differently", () => {
  const out = analyzeComplexity("frontend/app/page.tsx", `export default function Page({ items }: any) { return <ul>{items.map((a: any) => items.map((b: any) => <li>{a}{b}</li>))}</ul>; }`);
  expect(out[0]!.kind).toBe("component");
  expect(analyzeComplexity("backend/src/x.ts", `function Foo(xs: number[]) { for (const a of xs) for (const b of xs) f(a, b); }`)[0]!.kind).toBe("function");
});
