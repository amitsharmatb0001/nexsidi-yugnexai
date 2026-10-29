import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkAcceptanceTests,
  planScope,
  expandPlaceholders,
  testContext,
  saveAcceptanceTests,
  readAcceptanceTests,
  acceptanceTestsForPhase,
  type AcceptanceTest,
} from "./acceptance-tests.ts";
import { execWriteFile } from "../../packages/agent-runtime/src/tools/file.ts";

// 2026-10-29 (team plan, stage 3): acceptance tests are written from the approved plan before any code exists, and the
// Chief AI's check keeps only tests that prove a named plan item with what the plan has. No model; every rule here is code.

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "acc-"));
  writeFileSync(join(dir, "spec.json"), JSON.stringify({
    successCriteria: [
      "Customers can sign up with email and password (/sign-up) and sign in (/sign-in).",
      "Customers choose a same-day 15-minute pickup window.",
    ],
  }));
  writeFileSync(join(dir, "api-contract.json"), JSON.stringify({ endpoints: [
    { method: "POST", path: "/api/v1/auth/sign-up", description: "Customer registration." },
    { method: "POST", path: "/api/v1/auth/sign-in", description: "Sign in." },
    { method: "GET", path: "/api/v1/menu", description: "List menu items." },
    { method: "POST", path: "/api/v1/menu", description: "Create a menu item. Restricted to authenticated staff accounts." },
    { method: "PATCH", path: "/api/v1/menu/:id", description: "Update a menu item. Restricted to authenticated staff accounts." },
    { method: "POST", path: "/api/v1/orders", description: "Place a pre-order." },
    { method: "GET", path: "/api/v1/orders/:id", description: "One order." },
  ] }));
  writeFileSync(join(dir, "build-plan.json"), JSON.stringify({ buildPhases: [
    { name: "Foundation", goal: "Sign up and sign in", pages: ["/", "/sign-in", "/sign-up"], endpoints: ["POST /api/v1/auth/sign-up", "POST /api/v1/auth/sign-in"], tables: ["users"] },
    { name: "Ordering", goal: "Menu and orders", pages: ["/menu", "/order", "/orders/[id]"], endpoints: ["GET /api/v1/menu", "POST /api/v1/menu", "PATCH /api/v1/menu/:id", "POST /api/v1/orders", "GET /api/v1/orders/:id"], tables: ["menu_items", "orders"] },
  ] }));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const signUp: AcceptanceTest = {
  id: "AT-1-1",
  phase: 1,
  planItem: "SC1",
  title: "a new customer can sign up and then sign in",
  as: "anyone",
  kind: "api",
  steps: [
    { method: "POST", path: "/api/v1/auth/sign-up", body: { email: "{{email}}", password: "{{password}}" }, expectStatus: [200, 201], save: { token: "token" } },
    { method: "POST", path: "/api/v1/auth/sign-in", body: { email: "{{email}}", password: "{{password}}" }, expectStatus: 200, expectBody: [{ path: "token", exists: true }] },
  ],
};

const itemNameKept: AcceptanceTest = {
  id: "AT-2-1",
  phase: 2,
  planItem: "INT1",
  title: "an order keeps the item's name after staff rename the item",
  as: "user",
  kind: "api",
  steps: [
    { as: "staff", method: "POST", path: "/api/v1/menu", body: { name: "Flat White {{unique}}", price: 4.5 }, expectStatus: 201, save: { itemId: "id" } },
    { method: "POST", path: "/api/v1/orders", body: { items: [{ id: "{{itemId}}", quantity: 1 }], pickupAt: "{{datetime+1 10:15}}" }, expectStatus: 201, save: { orderId: "id" } },
    { as: "staff", method: "PATCH", path: "/api/v1/menu/{{itemId}}", body: { name: "Renamed" }, expectStatus: 200 },
    { method: "GET", path: "/api/v1/orders/{{orderId}}", expectStatus: 200, expectBody: [{ path: "items.0.name", contains: "Flat White" }] },
  ],
};

const signUpPage: AcceptanceTest = {
  id: "AT-1-2",
  phase: 1,
  planItem: "SC1",
  title: "a visitor signs up on the sign-up page",
  as: "anyone",
  kind: "journey",
  steps: [
    { do: "open", path: "/sign-up" },
    { do: "fill", field: "Email", value: "{{email}}" },
    { do: "fill", field: "Password", value: "{{password}}" },
    { do: "click", text: "Create account" },
    { do: "atPath", path: "/" },
  ],
};

test("the plan's scope: pages, endpoints and roles, each with the phase that builds it", () => {
  const s = planScope(dir);
  expect(s.phaseCount).toBe(2);
  expect(s.roles).toEqual(["staff"]);
  expect(s.endpoints).toContainEqual({ method: "PATCH", path: "/api/v1/menu/:id", phase: 2 });
  expect(s.pages).toContainEqual({ path: "/sign-up", phase: 1 });
  expect(s.itemIds.has("INT1")).toBe(true);
  expect(s.itemIds.has("SC2")).toBe(true);
});

test("tests that prove a plan item with what the plan has are accepted", () => {
  const r = checkAcceptanceTests([signUp, itemNameKept, signUpPage], dir);
  expect(r.rejected).toEqual([]);
  expect(r.accepted.map((t) => t.id)).toEqual(["AT-1-1", "AT-2-1", "AT-1-2"]);
});

test("a test that names no plan item is refused", () => {
  const r = checkAcceptanceTests([{ ...signUp, planItem: "SC9" }], dir);
  expect(r.accepted).toEqual([]);
  expect(r.rejected[0]!.reasons.join(" ")).toContain("SC9 is not an item of the approved plan");
});

test("a test that calls an endpoint the approved contract does not have is refused", () => {
  const bad: AcceptanceTest = { ...signUp, steps: [{ method: "DELETE", path: "/api/v1/orders/{{orderId}}", expectStatus: 204 }] };
  const r = checkAcceptanceTests([bad], dir);
  expect(r.rejected[0]!.reasons.join(" ")).toContain("DELETE /api/v1/orders/{{orderId}} is not in the approved API contract");
});

test("a journey that opens a page the plan does not have is refused", () => {
  const bad: AcceptanceTest = { ...signUpPage, steps: [{ do: "open", path: "/loyalty" }, { do: "see", text: "Points" }] };
  expect(checkAcceptanceTests([bad], dir).rejected[0]!.reasons.join(" ")).toContain("/loyalty is not a page of the approved plan");
});

test("a dynamic page of the plan may be opened with a saved or placeholder id", () => {
  const ok: AcceptanceTest = { ...signUpPage, id: "AT-2-9", phase: 2, as: "user", steps: [{ do: "open", path: "/orders/{{unique}}" }, { do: "see", text: "Order" }] };
  expect(checkAcceptanceTests([ok], dir).rejected).toEqual([]);
});

test("a test may not use what a later phase builds", () => {
  const early: AcceptanceTest = { ...itemNameKept, id: "AT-1-5", phase: 1 };
  const reasons = checkAcceptanceTests([early], dir).rejected[0]!.reasons.join(" ");
  expect(reasons).toContain("POST /api/v1/menu is built in phase 2");
});

test("a role the plan does not have is refused", () => {
  const bad: AcceptanceTest = { ...itemNameKept, as: "admin" };
  expect(checkAcceptanceTests([bad], dir).rejected[0]!.reasons.join(" ")).toContain('"admin" is not someone the plan has');
});

test("a value used before it is saved, or an unknown placeholder, is refused", () => {
  const bad: AcceptanceTest = {
    ...itemNameKept,
    steps: [
      { method: "GET", path: "/api/v1/orders/{{orderId}}", expectStatus: 200 },
      { method: "POST", path: "/api/v1/orders", body: { note: "{{storeHours}}" }, expectStatus: 201, save: { orderId: "id" } },
    ],
  };
  const reasons = checkAcceptanceTests([bad], dir).rejected[0]!.reasons.join(" ");
  expect(reasons).toContain("{{orderId}} is used before a step saves it");
  expect(reasons).toContain("{{storeHours}} is not a known value");
});

test("malformed steps are refused with what is wrong", () => {
  const bad = { ...signUpPage, steps: [{ do: "hover", text: "x" }, { do: "fill", field: "", value: "x" }] } as unknown as AcceptanceTest;
  const reasons = checkAcceptanceTests([bad], dir).rejected[0]!.reasons.join(" ");
  expect(reasons).toContain('step 1: "hover" is not a journey step');
  expect(reasons).toContain("step 2: fill needs a field");
  const noStatus = { ...signUp, steps: [{ method: "GET", path: "/api/v1/menu" }] } as unknown as AcceptanceTest;
  expect(checkAcceptanceTests([noStatus], dir).rejected[0]!.reasons.join(" ")).toContain("step 1: give the expected status");
  expect(checkAcceptanceTests([{ ...signUp, steps: [] }], dir).rejected[0]!.reasons.join(" ")).toContain("has no steps");
});

test("placeholders: a whole-value placeholder keeps its type; email and password are fixed for one test", () => {
  const ctx = testContext({ now: new Date(2026, 9, 29, 9, 0), stamp: "x1" });
  ctx.saved.itemId = 42;
  expect(expandPlaceholders({ id: "{{itemId}}", label: "item {{itemId}}" }, ctx)).toEqual({ id: 42, label: "item 42" });
  expect(expandPlaceholders("{{email}}", ctx)).toBe("verify+atx1@example.com");
  expect(expandPlaceholders("{{email}}", ctx)).toBe(expandPlaceholders("{{email}}", ctx));
  expect(expandPlaceholders("{{date+1}}", ctx)).toBe("2026-10-30");
  expect(String(expandPlaceholders("{{datetime+0 10:15}}", ctx))).toMatch(/^2026-10-29T10:15:00[+-]\d{2}:\d{2}$/);
  expect(String(expandPlaceholders("{{password}}", ctx))).toMatch(/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/);
});

test("the tests are kept in the build folder, where no builder can write", () => {
  saveAcceptanceTests(dir, { writtenAt: "t", tests: [signUp], rejected: [], notWritten: [] });
  expect(readAcceptanceTests(dir)?.tests.map((t) => t.id)).toEqual(["AT-1-1"]);
  for (const folder of ["backend", "frontend", "db"]) {
    mkdirSync(join(dir, folder), { recursive: true });
    expect(execWriteFile(join(dir, folder), { path: "../acceptance-tests.json", content: "{}" }).status).toBe("error");
  }
  expect(readAcceptanceTests(dir)?.tests.length).toBe(1);
});

test("each builder sees the phase's tests in plain lines: the frontend gets the journeys step by step", () => {
  const text = acceptanceTestsForPhase([signUp, itemNameKept, signUpPage], 1, "aanya");
  expect(text).toContain("AT-1-2 [SC1] a visitor signs up on the sign-up page");
  expect(text).toContain('fill "Email"');
  expect(text).toContain('click "Create account"');
  expect(text).toContain("AT-1-1 [SC1]");
  expect(text).not.toContain("AT-2-1");
  const backend = acceptanceTestsForPhase([signUp, itemNameKept, signUpPage], 2, "shubham");
  expect(backend).toContain("AT-2-1 [INT1]");
  expect(backend).toContain('PATCH /api/v1/menu/{{itemId}} as staff {"name":"Renamed"} → 200');
  expect(acceptanceTestsForPhase([], 1, "aanya")).toBe("");
});

// With builder teams the whole app is built in one pass (collapsePhasesForTeam): the builders then see every test.
test("in a one-pass team build every phase's tests are shown", () => {
  const text = acceptanceTestsForPhase([signUp, itemNameKept, signUpPage], "all", "shubham");
  expect(text).toContain("AT-1-1 [SC1]");
  expect(text).toContain("AT-2-1 [INT1]");
  expect(text).toContain("ACCEPTANCE TESTS FOR THIS BUILD");
});
