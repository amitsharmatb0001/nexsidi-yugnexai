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

// 2026-10-18 (Leafkeeper run): the smoke check passed on an app whose frontend was built to call the SOURCE app's API
// port, so sign-up said "Failed to fetch". The check now reads what the built frontend calls and asks the API whether
// it accepts the app's own address.
const HOME = (scripts: string[]) => `<html><body>${"x".repeat(300)}${scripts.map((s) => `<script src="${s}"></script>`).join("")}</body></html>`;

function appFetch(opts: { chunk: string; acao?: string | null }) {
  return async (url: string, init?: RequestInit) => {
    if (url === "http://fe/") return new Response(HOME(["/_next/static/chunks/a.js"]), { status: 200 });
    if (url === "http://fe/_next/static/chunks/a.js") return new Response(opts.chunk, { status: 200 });
    if (url.startsWith("http://be") && init?.method === "OPTIONS") {
      const headers = new Headers();
      if (opts.acao) headers.set("access-control-allow-origin", opts.acao);
      return new Response(null, { status: 204, headers });
    }
    return new Response("ok" + "x".repeat(300), { status: url.startsWith("http://be") ? 404 : 200 });
  };
}

const APP = { frontendUrl: "http://fe", backendUrl: "http://be", routes: ["/"], sleep: noWait, attempts: 1, publicOrigin: "http://localhost:3201", ownBackendPort: 3302 };

test("smokeCheck passes when the frontend calls its own API and the API allows the app's address", async () => {
  const r = await smokeCheck({ ...APP, fetchFn: appFetch({ chunk: 'fetch("http://localhost:3302/api/v1/x")', acao: "http://localhost:3201" }) });
  expect(r).toEqual({ ok: true, failures: [] });
});

test("smokeCheck fails, naming both ports, when the built frontend calls another app's API port", async () => {
  const r = await smokeCheck({ ...APP, fetchFn: appFetch({ chunk: 'const A="http://localhost:3308";', acao: "http://localhost:3201" }) });
  expect(r.ok).toBe(false);
  expect(r.failures[0]).toContain("3308");
  expect(r.failures[0]).toContain("3302");
});

test("smokeCheck fails when the API does not allow the app's own address", async () => {
  const r = await smokeCheck({ ...APP, fetchFn: appFetch({ chunk: "no addresses here", acao: "http://localhost:3207" }) });
  expect(r.ok).toBe(false);
  expect(r.failures[0]).toContain("3201");
});

test("smokeCheck does not fail on addresses outside the app ports or on its own frontend and database ports", async () => {
  const r = await smokeCheck({ ...APP, fetchFn: appFetch({ chunk: 'a="http://localhost:3201" b="http://localhost:3000" c="http://localhost:5438"', acao: "http://localhost:3201" }) });
  expect(r.ok).toBe(true);
});

test("smokeCheck skips these two checks when it is not given the app's public address and backend port", async () => {
  const r = await smokeCheck({ frontendUrl: "http://fe", backendUrl: "http://be", routes: ["/"], sleep: noWait, attempts: 1, fetchFn: appFetch({ chunk: 'x="http://localhost:3308"', acao: null }) });
  expect(r.ok).toBe(true);
});

test("smokeCheck reads the scripts of every page, because the API address is often only in the sign-up page's script", async () => {
  const fetchFn = async (url: string, init?: RequestInit) => {
    if (url === "http://fe/") return new Response(HOME(["/_next/static/chunks/home.js"]), { status: 200 });
    if (url === "http://fe/sign-up") return new Response(HOME(["/_next/static/chunks/home.js", "/_next/static/chunks/auth.js"]), { status: 200 });
    if (url === "http://fe/_next/static/chunks/home.js") return new Response("nothing here", { status: 200 });
    if (url === "http://fe/_next/static/chunks/auth.js") return new Response('const A="http://localhost:3308";', { status: 200 });
    if (url.startsWith("http://be") && init?.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "http://localhost:3201" } });
    return new Response("ok" + "x".repeat(300), { status: url.startsWith("http://be") ? 404 : 200 });
  };
  const r = await smokeCheck({ ...APP, routes: ["/", "/sign-up"], fetchFn });
  expect(r.ok).toBe(false);
  expect(r.failures[0]).toContain("3308");
});
