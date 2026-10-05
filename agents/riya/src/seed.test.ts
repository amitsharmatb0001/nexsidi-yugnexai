import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedSampleData } from "./index.ts";

// 2026-10-05 (Amit): the app is tested with generated sample data for every resource — then all of it is removed.
// The seeder creates records through the app's own API as a test account, parents before children, so every page
// (including the detail pages that need a real id) has something to show.
let dir = "";
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

const setup = (endpoints: unknown[], types: string) => {
  dir = mkdtempSync(join(tmpdir(), "seed-"));
  writeFileSync(join(dir, "api-contract.json"), JSON.stringify({ endpoints }));
  writeFileSync(join(dir, "shared-types.ts"), types);
};

const TYPES = `
export interface Client { id: string; name: string; email: string; }
export interface Invoice { id: string; client_id: string; total: number; }
`;
const ENDPOINTS = [
  { method: "POST", path: "/api/v1/auth/sign-up", auth: false, requestType: "{ email: string; password: string }" },
  { method: "GET", path: "/api/v1/invoices", auth: true, requestType: "null" },
  { method: "POST", path: "/api/v1/invoices", auth: true, requestType: "Omit<Invoice, 'id'>" },
  { method: "GET", path: "/api/v1/clients", auth: true, requestType: "null" },
  { method: "POST", path: "/api/v1/clients", auth: true, requestType: "Omit<Client, 'id'>" },
];

function fakeBackend(opts: { rejectInvoices?: boolean } = {}) {
  const log: string[] = [];
  const clients: Array<{ id: string }> = [];
  let n = 0;
  globalThis.fetch = (async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? "GET";
    log.push(`${method} ${path}`);
    if (init?.headers?.Authorization !== "Bearer tok") return new Response("{}", { status: 401 });
    if (method === "GET" && path === "/api/v1/clients") return new Response(JSON.stringify({ success: true, data: { clients } }), { status: 200 });
    if (method === "GET" && path === "/api/v1/invoices") return new Response(JSON.stringify({ success: true, data: { invoices: [] } }), { status: 200 });
    if (method === "POST" && path === "/api/v1/clients") {
      const body = JSON.parse(init?.body ?? "{}");
      if (!/^[^\s@]+@[^\s@]+$/.test(String(body.email ?? ""))) return new Response(JSON.stringify({ success: false, error: "email: Invalid email address" }), { status: 400 });
      const c = { id: `c${++n}` };
      clients.push(c);
      return new Response(JSON.stringify({ success: true, data: { client: c } }), { status: 201 });
    }
    if (method === "POST" && path === "/api/v1/invoices") {
      const body = JSON.parse(init?.body ?? "{}");
      log.push(`invoice body client_id=${body.client_id}`);
      if (opts.rejectInvoices) return new Response(JSON.stringify({ success: false, error: "Validation failed: total must be positive" }), { status: 400 });
      return new Response(JSON.stringify({ success: true, data: { id: `i${++n}` } }), { status: 201 });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { log, clients };
}

test("seedSampleData creates parents before children and gives children a real parent id", async () => {
  setup(ENDPOINTS, TYPES);
  const b = fakeBackend();
  const r = await seedSampleData(dir, "http://api", "tok", 2);
  expect(r.created.clients).toEqual(["c1", "c2"]);
  expect(r.created.invoices).toHaveLength(2);
  expect(r.notSeeded).toEqual([]);
  const firstClientPost = b.log.indexOf("POST /api/v1/clients");
  const firstInvoicePost = b.log.indexOf("POST /api/v1/invoices");
  expect(firstClientPost).toBeGreaterThan(-1);
  expect(firstClientPost).toBeLessThan(firstInvoicePost);
  expect(b.log.filter((l) => l.startsWith("invoice body")).every((l) => /client_id=c\d/.test(l))).toBe(true);
});

test("seedSampleData says what it could not create and why, instead of pretending", async () => {
  setup(ENDPOINTS, TYPES);
  fakeBackend({ rejectInvoices: true });
  const r = await seedSampleData(dir, "http://api", "tok", 2);
  expect(r.created.clients).toHaveLength(2);
  expect(r.created.invoices ?? []).toEqual([]);
  expect(r.notSeeded.join("\n")).toContain("invoices");
  expect(r.notSeeded.join("\n")).toContain("Validation failed: total must be positive");
});

test("seedSampleData skips the auth routes and resources with no create endpoint", async () => {
  setup([...ENDPOINTS, { method: "GET", path: "/api/v1/dashboard", auth: true, requestType: "null" }], TYPES);
  const b = fakeBackend();
  const r = await seedSampleData(dir, "http://api", "tok", 1);
  expect(Object.keys(r.created).sort()).toEqual(["clients", "invoices"]);
  expect(b.log.some((l) => l.includes("auth"))).toBe(false);
});
