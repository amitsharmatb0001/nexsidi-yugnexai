import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyAllResourceCrud } from "./index.ts";

// 2026-10-24 (Brewline root cause): the create/read/update/delete check got 403 creating a menu item (staff only), skipped
// the resource with `continue`, and still printed "every resource's create/read/update/delete confirmed". Now it gets a
// token for the contract's own role (a test account given that role before sign-in), and anything it still cannot do
// is reported as not checked — never as confirmed.

let dir = "";
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

function setup(): string {
  dir = mkdtempSync(join(tmpdir(), "crud-roles-"));
  writeFileSync(join(dir, "api-contract.json"), JSON.stringify({ endpoints: [
    { method: "POST", path: "/api/v1/auth/sign-up", auth: false, requestType: "{ email: string; password: string }" },
    { method: "POST", path: "/api/v1/auth/sign-in", auth: false, requestType: "{ email: string; password: string }" },
    { method: "GET", path: "/api/v1/menu", auth: false, requestType: "null" },
    { method: "POST", path: "/api/v1/menu", auth: true, requestType: "{ name: string }", description: "Add a menu item (staff only)." },
  ] }));
  writeFileSync(join(dir, "shared-types.ts"), "");
  return dir;
}

function fakeBackend(staff: Set<string>) {
  globalThis.fetch = (async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : {};
    if (path.endsWith("/auth/sign-up")) return new Response(JSON.stringify({ data: { token: "user" } }), { status: 201 });
    if (path.endsWith("/auth/sign-in")) return new Response(JSON.stringify({ data: { token: staff.has(body.email) ? "staff" : "user" } }), { status: 200 });
    if (path === "/api/v1/menu" && method === "POST") {
      return init?.headers?.Authorization === "Bearer staff"
        ? new Response(JSON.stringify({ data: { id: "m1" } }), { status: 201 })
        : new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    }
    if (path === "/api/v1/menu") return new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
}

test("a role-limited create is checked with a test account given the contract's role", async () => {
  const d = setup();
  const staff = new Set<string>();
  fakeBackend(staff);
  const granted: string[] = [];
  const r = await verifyAllResourceCrud(d, "http://b", () => ({ id: "m1", name: "x" }), (email, role) => {
    granted.push(role);
    staff.add(email);
    return { ok: true };
  });
  expect(granted).toEqual(["staff"]);
  expect(r.notChecked ?? []).toEqual([]);
  expect(r.ok).toBe(true);
});

test("a create the check still cannot do is reported as not checked, never as confirmed", async () => {
  const d = setup();
  fakeBackend(new Set());
  const r = await verifyAllResourceCrud(d, "http://b", () => null, () => ({ reason: "no database container" }));
  expect(r.notChecked?.some((n) => n.includes("menu") && n.includes("403"))).toBe(true);
  expect(r.ok).toBe(true);
});

test("the deploy step's message says what was not checked instead of 'every resource confirmed'", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  expect(src).not.toContain("full CRUD verification OK — every resource's create/read/update/delete confirmed against the real database`");
  expect(src).toContain("CRUD verification: not checked");
});
