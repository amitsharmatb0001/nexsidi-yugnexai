import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { staticRoutes, smokeCheck } from "./clone-smoke.ts";

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function page(root: string, rel: string): void {
  const full = join(root, "app", rel, "page.tsx");
  mkdirSync(join(root, "app", rel), { recursive: true });
  writeFileSync(full, "export default function P() { return null; }\n");
}

// ── staticRoutes ──────────────────────────────────────────────────────────
test("staticRoutes lists the pages a visitor can open by URL alone, skipping dynamic ones and route-group folders", () => {
  dir = mkdtempSync(join(tmpdir(), "nexsidi-smoke-"));
  page(dir, "");
  page(dir, "pricing");
  page(dir, "(marketing)/about");
  page(dir, "invoices");
  page(dir, "invoices/[id]");
  page(dir, "api/health");
  expect(staticRoutes(dir)).toEqual(["/", "/about", "/invoices", "/pricing"]);
});

test("staticRoutes is empty when there is no app folder", () => {
  dir = mkdtempSync(join(tmpdir(), "nexsidi-smoke-"));
  expect(staticRoutes(dir)).toEqual([]);
});

// ── smokeCheck ────────────────────────────────────────────────────────────
const noWait = async () => {};
const res = (status: number, body = "<html><body>" + "x".repeat(300) + "</body></html>") => new Response(body, { status });

test("smokeCheck passes when the home page renders, other pages answer (a redirect to sign-in counts), and the API is alive", async () => {
  const fetchFn = async (url: string) => {
    if (url === "http://fe/") return res(200);
    if (url === "http://fe/invoices") return new Response(null, { status: 307, headers: { location: "/sign-in" } });
    if (url === "http://be/") return res(404, "not found");
    return res(200);
  };
  const r = await smokeCheck({ frontendUrl: "http://fe", backendUrl: "http://be", routes: ["/", "/invoices", "/pricing"], fetchFn, sleep: noWait });
  expect(r).toEqual({ ok: true, failures: [] });
});

test("smokeCheck fails, naming the page, when a page answers with a server error", async () => {
  const fetchFn = async (url: string) => (url === "http://fe/pricing" ? res(500) : res(200));
  const r = await smokeCheck({ frontendUrl: "http://fe", backendUrl: "http://be", routes: ["/", "/pricing"], fetchFn, sleep: noWait, attempts: 2 });
  expect(r.ok).toBe(false);
  expect(r.failures).toEqual(["/pricing answered 500"]);
});

test("smokeCheck fails when the home page is blank", async () => {
  const fetchFn = async (url: string) => (url === "http://fe/" ? res(200, "") : res(200));
  const r = await smokeCheck({ frontendUrl: "http://fe", backendUrl: "http://be", routes: ["/"], fetchFn, sleep: noWait, attempts: 1 });
  expect(r.ok).toBe(false);
  expect(r.failures[0]).toContain("/");
});

test("smokeCheck fails when the API cannot be reached", async () => {
  const fetchFn = async (url: string) => {
    if (url.startsWith("http://be")) throw new Error("ECONNREFUSED");
    return res(200);
  };
  const r = await smokeCheck({ frontendUrl: "http://fe", backendUrl: "http://be", routes: ["/"], fetchFn, sleep: noWait, attempts: 1 });
  expect(r.ok).toBe(false);
  expect(r.failures[0]).toContain("API");
});

test("smokeCheck keeps trying while the app warms up, and passes once it answers", async () => {
  let calls = 0;
  const fetchFn = async (url: string) => {
    if (url === "http://fe/") {
      calls += 1;
      if (calls < 3) throw new Error("ECONNREFUSED");
    }
    return res(200);
  };
  const r = await smokeCheck({ frontendUrl: "http://fe", backendUrl: "http://be", routes: ["/"], fetchFn, sleep: noWait, attempts: 5 });
  expect(r.ok).toBe(true);
  expect(calls).toBe(3);
});
