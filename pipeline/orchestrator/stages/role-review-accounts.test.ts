import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { limitedRolesFromContract, grantTestAccountRole, roleGrantSql, seedSampleData } from "../../../agents/riya/src/index.ts";
import { reviewAccountSection } from "../../../agents/tilotma/src/review-account.ts";
import { createReviewAccount } from "./route-sweep.ts";

// 2026-10-24 (Brewline test build, live review): the app has staff-only pages ("Add a menu item (staff only)"), but the
// review got one ordinary customer account and no sample data (customers cannot add menu items, so orders could not be
// made either). The reality checker spent about 20 calls and 4 sub-checks hunting for a staff login and then had a
// sub-check overwrite the real staff account's password. Now the review stage gives every limited role its own test
// account (reserved test domain, removed with everything else after the review), seeds sample data with whichever
// account may create each record, and tells the checkers to use those accounts and never change any account.

let dir = "";
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

const BREWLINE = [
  { method: "POST", path: "/api/v1/auth/sign-up", description: "Create a new user account with email and password." },
  { method: "POST", path: "/api/v1/auth/sign-in", description: "Authenticate an existing user (customer or staff) with email and password." },
  { method: "GET", path: "/api/v1/menu", description: "List all menu items." },
  { method: "POST", path: "/api/v1/menu", description: "Add a new drink or pastry item to the menu catalog (staff only)." },
  { method: "PATCH", path: "/api/v1/orders/:id/status", description: "Update the status of a pre-order (staff only)." },
  { method: "GET", path: "/api/v1/orders/me", description: "List the authenticated customer's orders (owner only)." },
];

test("the limited roles are read from the contract; owner/authenticated are not roles", () => {
  expect(limitedRolesFromContract(BREWLINE)).toEqual(["staff"]);
  expect(limitedRolesFromContract([{ description: "Delete any user (Admin only)" }, { description: "Approve a refund (manager or admin only)" }, { description: "Admin-only report" }]).sort()).toEqual(["admin", "manager"]);
  expect(limitedRolesFromContract([{ description: "Signed-in users only" }, { description: "(authenticated only)" }, {}])).toEqual([]);
});

test("a role is given only to an account on the reserved test domain, with a plain role name", () => {
  expect(grantTestAccountRole("/nowhere", "owner@brewline.com", "staff")).toEqual({ reason: expect.stringContaining("not a test account") });
  expect(grantTestAccountRole("/nowhere", "verify+review1@example.com", "staff'; DROP TABLE users; --")).toEqual({ reason: expect.stringContaining("not a plain role name") });
  const sql = roleGrantSql("users", "verify+review1@example.com", "staff");
  expect(sql).toBe(`UPDATE "users" SET role = 'staff' WHERE email = 'verify+review1@example.com'`);
});

test("sample data skips resources another account already created", async () => {
  dir = mkdtempSync(join(tmpdir(), "rra-"));
  writeFileSync(join(dir, "api-contract.json"), JSON.stringify({ endpoints: [
    { method: "POST", path: "/api/v1/menu", auth: true, requestType: "{ name: string }" },
    { method: "POST", path: "/api/v1/orders", auth: true, requestType: "{ note: string }" },
  ] }));
  writeFileSync(join(dir, "shared-types.ts"), "");
  const posted: string[] = [];
  globalThis.fetch = (async (url: string) => {
    posted.push(new URL(String(url)).pathname);
    return new Response(JSON.stringify({ data: { id: `x${posted.length}` } }), { status: 201 });
  }) as unknown as typeof fetch;
  const r = await seedSampleData(dir, "http://b", "tok", 1, new Set(["menu"]));
  expect(posted).toEqual(["/api/v1/orders"]);
  expect(Object.keys(r.created)).toEqual(["orders"]);
});

test("the role is given between sign-up and sign-in, so the sign-in token carries it", async () => {
  const order: string[] = [];
  const fetchFn = (async (url: string) => {
    order.push(new URL(String(url)).pathname);
    return new Response(JSON.stringify({ token: "t" }), { status: 200 });
  }) as unknown as typeof fetch;
  const acct = await createReviewAccount({
    backendUrl: "http://b",
    endpoints: BREWLINE,
    fetchFn,
    beforeLogin: async (email) => { order.push(`grant ${email.endsWith("@example.com")}`); },
  });
  expect("token" in acct).toBe(true);
  expect(order).toEqual(["/api/v1/auth/sign-up", "grant true", "/api/v1/auth/sign-in"]);
});

test("the checkers get every role account and are told never to change an account", () => {
  const s = reviewAccountSection({ email: "verify+review1@example.com", password: "p1" }, {}, [{ role: "staff", email: "verify+staff1@example.com", password: "p2" }]);
  expect(s).toContain("staff");
  expect(s).toContain("verify+staff1@example.com");
  expect(s).toContain("p2");
  expect(s).toMatch(/never change any account's password or role/i);
});

test("the review stage creates the role accounts, seeds with them, hands them over, and clears them afterwards", () => {
  const src = readFileSync(new URL("./stage6-deployment.ts", import.meta.url), "utf-8");
  expect(src).toContain("limitedRolesFromContract(");
  expect(src).toContain("grantTestAccountRole(");
  expect(src).toContain("process.env.TIER3_REVIEW_ROLE_ACCOUNTS =");
  expect(src).toContain("delete process.env.TIER3_REVIEW_ROLE_ACCOUNTS");
});

// 2026-10-29 (Brewline 3): its contract said "Restricted to authenticated staff accounts." and no role was found, so the
// plan's yardstick read "no other role exists" and the live review had no staff account.
test("'restricted to authenticated staff accounts' names the staff role", () => {
  expect(limitedRolesFromContract([
    { description: "Create a new menu item (drink or pastry). Restricted to authenticated staff accounts." },
    { description: "Sign in for both customers and shop-provisioned staff accounts using email and password." },
    { description: "Requires an authenticated account (no guest checkout)." },
  ])).toEqual(["staff"]);
  expect(limitedRolesFromContract([{ description: "Restricted to manager or admin users." }]).sort()).toEqual(["admin", "manager"]);
});
