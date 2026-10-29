import { test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAcceptanceTests, recordAcceptanceRun, acceptanceFacts, pathMatches, type BrowserLike } from "./acceptance-runner.ts";
import type { AcceptanceTest } from "./acceptance-tests.ts";

// 2026-10-29 (team plan, stage 3): the fixed runner (no model) runs the acceptance tests against the running app. A test it
// cannot run is "not checked", never passed or failed. The stub app below stands in for a generated app: it answers the
// way a real backend does (an envelope around some answers, prices as strings from Postgres numeric columns) and can be
// switched to the Brewline 3 bug — an order line that shows the item's CURRENT name instead of the name at order time.

let server: ReturnType<typeof Bun.serve>;
let api = "";
const app = { keepNameAtOrderTime: true, menuCalls: 0, limitFirstMenuCall: false };
const users = new Map<string, string>();
const items = new Map<string, { id: string; name: string; price: string }>();
const orders = new Map<string, { id: string; owner: string; lines: Array<{ itemId: string; name: string }> }>();

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const auth = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
      const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
      const body = req.method === "GET" ? {} : ((await req.json().catch(() => ({}))) as Record<string, any>);
      if (url.pathname === "/api/v1/auth/sign-up" && req.method === "POST") {
        if (!body.email || !body.password) return json(400, { error: "email and password are required" });
        if (users.has(body.email)) return json(409, { error: "taken" });
        users.set(body.email, body.password);
        return json(201, { token: `user:${body.email}`, user: { email: body.email, role: "customer" } });
      }
      if (url.pathname === "/api/v1/auth/sign-in" && req.method === "POST") {
        if (users.get(body.email) !== body.password) return json(401, { error: "wrong email or password" });
        return json(200, { data: { token: `user:${body.email}` } });
      }
      if (url.pathname === "/api/v1/menu" && req.method === "GET") {
        app.menuCalls++;
        if (app.limitFirstMenuCall && app.menuCalls === 1) return json(429, { error: "slow down" }, { "retry-after": "2" });
        return json(200, { items: [...items.values()] });
      }
      if (url.pathname === "/api/v1/menu" && req.method === "POST") {
        if (auth !== "staff-token") return json(403, { error: "staff only" });
        const id = String(items.size + 1);
        items.set(id, { id, name: body.name, price: Number(body.price).toFixed(2) });
        return json(201, items.get(id));
      }
      const menuId = url.pathname.match(/^\/api\/v1\/menu\/([^/]+)$/)?.[1];
      if (menuId && req.method === "PATCH") {
        if (auth !== "staff-token") return json(403, { error: "staff only" });
        const it = items.get(menuId);
        if (!it) return json(404, { error: "no such item" });
        Object.assign(it, body.name ? { name: body.name } : {});
        return json(200, it);
      }
      if (url.pathname === "/api/v1/orders" && req.method === "POST") {
        if (!auth) return json(401, { error: "sign in first" });
        const id = `o${orders.size + 1}`;
        orders.set(id, { id, owner: auth, lines: (body.items ?? []).map((l: { id: string }) => ({ itemId: String(l.id), name: items.get(String(l.id))?.name ?? "?" })) });
        return json(201, { id });
      }
      const orderId = url.pathname.match(/^\/api\/v1\/orders\/([^/]+)$/)?.[1];
      if (orderId && req.method === "GET") {
        const o = orders.get(orderId);
        if (!o || o.owner !== auth) return json(404, { error: "not found" });
        const lines = o.lines.map((l) => ({ name: app.keepNameAtOrderTime ? l.name : items.get(l.itemId)?.name }));
        return json(200, { data: { id: o.id, items: lines } });
      }
      return json(404, { error: "no route" });
    },
  });
  api = `http://127.0.0.1:${server.port}`;
});
afterAll(() => {
  server.stop(true);
});
beforeEach(() => {
  app.keepNameAtOrderTime = true;
  app.menuCalls = 0;
  app.limitFirstMenuCall = false;
});

const accounts = {
  user: { email: "verify+u@example.com", password: "pw", token: "user:verify+u@example.com" },
  staff: { email: "verify+s@example.com", password: "pw", token: "staff-token" },
};
const noSleep = async () => {};

const signUpThenIn: AcceptanceTest = {
  id: "AT-1-1", phase: 1, planItem: "SC2", title: "a new customer can sign up and sign in", as: "anyone", kind: "api",
  steps: [
    { method: "POST", path: "/api/v1/auth/sign-up", body: { email: "{{email}}", password: "{{password}}" }, expectStatus: [200, 201], expectBody: [{ path: "user.role", equals: "customer" }] },
    { method: "POST", path: "/api/v1/auth/sign-in", body: { email: "{{email}}", password: "{{password}}" }, expectStatus: 200, save: { token: "token" }, expectBody: [{ path: "token", exists: true }] },
  ],
};

const nameKept: AcceptanceTest = {
  id: "AT-2-1", phase: 2, planItem: "INT1", title: "an order keeps the item's name after staff rename it", as: "user", kind: "api",
  steps: [
    { as: "staff", method: "POST", path: "/api/v1/menu", body: { name: "Flat White", price: 4.5 }, expectStatus: 201, save: { itemId: "id" }, expectBody: [{ path: "price", equals: 4.5 }] },
    { method: "POST", path: "/api/v1/orders", body: { items: [{ id: "{{itemId}}", quantity: 1 }] }, expectStatus: 201, save: { orderId: "id" } },
    { as: "staff", method: "PATCH", path: "/api/v1/menu/{{itemId}}", body: { name: "Renamed Latte" }, expectStatus: 200 },
    { method: "GET", path: "/api/v1/orders/{{orderId}}", expectStatus: 200, expectBody: [{ path: "items.0.name", equals: "Flat White" }] },
  ],
};

test("API tests pass on an app that does what the plan says (saved values, an envelope, a price stored as text)", async () => {
  const r = await runAcceptanceTests([signUpThenIn, nameKept], { apiUrl: api, appUrl: "http://unused", accounts, sleep: noSleep });
  expect(r.results.map((x) => [x.id, x.status, x.detail])).toEqual([
    ["AT-1-1", "passed", expect.any(String)],
    ["AT-2-1", "passed", expect.any(String)],
  ]);
  expect(r.passed).toBe(2);
});

test("the item-name rule fails on an app that shows the current name, and says what it got", async () => {
  app.keepNameAtOrderTime = false;
  const r = await runAcceptanceTests([nameKept], { apiUrl: api, appUrl: "http://unused", accounts, sleep: noSleep });
  expect(r.results[0]!.status).toBe("failed");
  expect(r.results[0]!.step).toBe(4);
  expect(r.results[0]!.detail).toContain('items.0.name should equal "Flat White" but is "Renamed Latte"');
});

test("a wrong status fails with the step, what was expected and what came back", async () => {
  const t: AcceptanceTest = { ...nameKept, id: "AT-2-2", planItem: "SEC1", title: "a customer cannot add a menu item", steps: [
    { method: "POST", path: "/api/v1/menu", body: { name: "x", price: 1 }, expectStatus: 201 },
  ] };
  const r = await runAcceptanceTests([t], { apiUrl: api, appUrl: "http://unused", accounts, sleep: noSleep });
  expect(r.results[0]).toMatchObject({ status: "failed", step: 1 });
  expect(r.results[0]!.detail).toContain("step 1 (POST /api/v1/menu): expected 201, got 403");
  expect(r.results[0]!.detail).toContain("staff only");
});

test("an app that does not answer is not checked, never failed", async () => {
  const r = await runAcceptanceTests([signUpThenIn], { apiUrl: "http://127.0.0.1:1", appUrl: "http://unused", accounts, sleep: noSleep });
  expect(r.results[0]!.status).toBe("not_checked");
  expect(r.results[0]!.detail).toContain("the app did not answer");
  expect(r.notChecked).toBe(1);
});

test("a test for someone who has no account in this run is not checked", async () => {
  const r = await runAcceptanceTests([nameKept], { apiUrl: api, appUrl: "http://unused", accounts: { user: accounts.user }, sleep: noSleep });
  expect(r.results[0]).toMatchObject({ status: "not_checked" });
  expect(r.results[0]!.detail).toContain("no staff account");
});

test("the app's rate limit is waited out once, as its Retry-After says", async () => {
  app.limitFirstMenuCall = true;
  const waits: number[] = [];
  const t: AcceptanceTest = { id: "AT-2-3", phase: 2, planItem: "EP3", title: "anyone can list the menu", as: "anyone", kind: "api", steps: [{ method: "GET", path: "/api/v1/menu", expectStatus: 200, expectBody: [{ path: "items", exists: true }] }] };
  const r = await runAcceptanceTests([t], { apiUrl: api, appUrl: "http://unused", accounts, sleep: async (ms) => void waits.push(ms) });
  expect(r.results[0]!.status).toBe("passed");
  expect(waits).toEqual([3000]);
});

// ── Journeys, with a stand-in browser that answers like the worker does ────

function fakeBrowser(page: { text: string[]; fields: string[]; buttons: string[]; url: string }) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  let textIndex = 0;
  const b: BrowserLike = {
    async send(action, args = {}) {
      calls.push([action, args]);
      switch (action) {
        case "newSession": return { reset: true };
        case "navigate": return { status: 200, url: String(args.url) };
        case "evaluate": return { value: null };
        case "fillField":
          if (!page.fields.includes(String(args.field))) throw new Error(`no field labelled "${args.field}" on the page`);
          return { filled: args.field };
        case "clickText":
          if (!page.buttons.includes(String(args.text))) throw new Error(`nothing to click with the text "${args.text}"`);
          return { clicked: args.text };
        case "getVisibleText": return { text: page.text[Math.min(textIndex++, page.text.length - 1)] };
        case "currentUrl": return { url: page.url };
        default: throw new Error(`unknown action ${action}`);
      }
    },
    async close() {},
  };
  return { b, calls };
}

const signUpJourney: AcceptanceTest = {
  id: "AT-1-2", phase: 1, planItem: "SC2", title: "a visitor signs up on the sign-up page", as: "anyone", kind: "journey",
  steps: [
    { do: "open", path: "/sign-up" },
    { do: "fill", field: "Email", value: "{{email}}" },
    { do: "fill", field: "Password", value: "{{password}}" },
    { do: "click", text: "Create account" },
    { do: "see", text: "Welcome to Brewline" },
    { do: "atPath", path: "/menu" },
  ],
};

test("a journey drives the browser step by step, and waits for text that appears after a click", async () => {
  const { b, calls } = fakeBrowser({ text: ["Loading…", "Loading…", "Welcome to   Brewline!"], fields: ["Email", "Password"], buttons: ["Create account"], url: "http://app/menu" });
  const r = await runAcceptanceTests([signUpJourney], { apiUrl: api, appUrl: "http://app", accounts, sleep: noSleep, openBrowser: async () => b, waitMs: 2000, pollMs: 100 });
  expect(r.results[0]).toMatchObject({ status: "passed" });
  expect(calls.map((c) => c[0])).toEqual(["newSession", "navigate", "fillField", "fillField", "clickText", "getVisibleText", "getVisibleText", "getVisibleText", "currentUrl"]);
  expect(String(calls[2]![1].value)).toMatch(/^verify\+at.+@example\.com$/);
});

test("a journey fails on a missing field, and says which field on which page", async () => {
  const { b } = fakeBrowser({ text: [""], fields: ["Email address"], buttons: [], url: "http://app/sign-up" });
  const r = await runAcceptanceTests([signUpJourney], { apiUrl: api, appUrl: "http://app", accounts, sleep: noSleep, openBrowser: async () => b });
  expect(r.results[0]).toMatchObject({ status: "failed", step: 2 });
  expect(r.results[0]!.detail).toContain('no field labelled "Email"');
});

test("text that never appears fails with what the page showed instead", async () => {
  const { b } = fakeBrowser({ text: ["Sign up failed: password too short"], fields: ["Email", "Password"], buttons: ["Create account"], url: "http://app/sign-up" });
  const r = await runAcceptanceTests([signUpJourney], { apiUrl: api, appUrl: "http://app", accounts, sleep: noSleep, openBrowser: async () => b, waitMs: 300, pollMs: 100 });
  expect(r.results[0]).toMatchObject({ status: "failed", step: 5 });
  expect(r.results[0]!.detail).toContain('did not see "Welcome to Brewline"');
  expect(r.results[0]!.detail).toContain("password too short");
});

test("a signed-in journey starts with the account's session; a browser that cannot start leaves journeys not checked", async () => {
  const { b, calls } = fakeBrowser({ text: ["My orders"], fields: [], buttons: [], url: "http://app/my-orders" });
  const mine: AcceptanceTest = { id: "AT-3-1", phase: 3, planItem: "SC5", title: "a customer sees their orders", as: "user", kind: "journey", steps: [{ do: "open", path: "/my-orders" }, { do: "see", text: "My orders" }] };
  const ok = await runAcceptanceTests([mine], { apiUrl: api, appUrl: "http://app", accounts, sleep: noSleep, openBrowser: async () => b });
  expect(ok.results[0]!.status).toBe("passed");
  const cookie = calls.find((c) => c[0] === "evaluate");
  expect(String(cookie![1].expression)).toContain(`token=${accounts.user.token}`);

  const r = await runAcceptanceTests([mine, signUpThenIn], { apiUrl: api, appUrl: "http://app", accounts, sleep: noSleep, openBrowser: async () => { throw new Error("chromium is not installed"); } });
  expect(r.results.map((x) => x.status)).toEqual(["not_checked", "passed"]);
  expect(r.results[0]!.detail).toContain("the browser could not start: chromium is not installed");
});

test("a page path with a placeholder matches the real page", () => {
  expect(pathMatches("/orders/[id]", "/orders/42")).toBe(true);
  expect(pathMatches("/orders/{{orderId}}", "/orders/42?tab=1")).toBe(true);
  expect(pathMatches("/menu", "/menu/")).toBe(true);
  expect(pathMatches("/menu", "/sign-in")).toBe(false);
});

test("each run is kept, and the success sheet reads the last one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "accrun-"));
  try {
    expect(acceptanceFacts(dir)).toBeNull();
    recordAcceptanceRun(dir, { at: "2026-10-29T10:00:00Z", results: [], passed: 1, failed: 2, notChecked: 0 });
    recordAcceptanceRun(dir, { at: "2026-10-29T11:00:00Z", results: [], passed: 3, failed: 0, notChecked: 1 });
    expect(existsSync(join(dir, "acceptance-results.json"))).toBe(true);
    expect(readFileSync(join(dir, "acceptance-runs.jsonl"), "utf-8").trim().split("\n").length).toBe(2);
    expect(acceptanceFacts(dir)).toEqual({ runs: 2, last: { at: "2026-10-29T11:00:00Z", passed: 3, failed: 0, notChecked: 1, total: 4 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 2026-10-29 (stage 3 proof with the real browser): a click that starts a navigation made the next read of the page fail
// with "Execution context was destroyed", and the runner reported a correct app as failed. A page that is changing is
// read again until the wait runs out.
test("a page read that fails while the page is changing is tried again, not failed", async () => {
  const { b } = fakeBrowser({ text: ["Welcome to Brewline"], fields: ["Email", "Password"], buttons: ["Create account"], url: "http://app/menu" });
  const send = b.send.bind(b);
  let reads = 0;
  b.send = async (action, args) => {
    if (action === "getVisibleText" && reads++ === 0) throw new Error("page.evaluate: Execution context was destroyed, most likely because of a navigation");
    if (action === "currentUrl" && reads < 2) throw new Error("navigation in progress");
    return send(action, args);
  };
  const r = await runAcceptanceTests([signUpJourney], { apiUrl: api, appUrl: "http://app", accounts, sleep: noSleep, openBrowser: async () => b, waitMs: 1000, pollMs: 100 });
  expect(r.results[0]).toMatchObject({ status: "passed" });
});

// 2026-10-29 (stage 3 proof): a request on a reused connection never reached the stub app and the run sat for minutes.
// Each request now has its own time limit and its own connection; a request that gets no answer is not checked.
test("a request that gets no answer in time is not checked, and the run goes on", async () => {
  const silent = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
  try {
    const t0 = Date.now();
    const r = await runAcceptanceTests([signUpThenIn], { apiUrl: `http://127.0.0.1:${silent.port}`, appUrl: "http://unused", accounts, sleep: noSleep, requestTimeoutMs: 300 });
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(r.results[0]).toMatchObject({ status: "not_checked", step: 1 });
    expect(r.results[0]!.detail).toContain("gave no answer within 0.3 s");
  } finally {
    silent.stop(true);
  }
});

test("a signed-in journey on an app that is down says the app did not answer", async () => {
  const { b } = fakeBrowser({ text: [""], fields: [], buttons: [], url: "" });
  const send = b.send.bind(b);
  b.send = async (action, args) => (action === "navigate" ? Promise.reject(new Error("page.goto: net::ERR_CONNECTION_REFUSED at http://app/")) : send(action, args));
  const mine: AcceptanceTest = { id: "AT-3-1", phase: 3, planItem: "SC5", title: "a customer sees their orders", as: "user", kind: "journey", steps: [{ do: "open", path: "/my-orders" }, { do: "see", text: "My orders" }] };
  const r = await runAcceptanceTests([mine], { apiUrl: api, appUrl: "http://app", accounts, sleep: noSleep, openBrowser: async () => b });
  expect(r.results[0]).toMatchObject({ status: "not_checked" });
  expect(r.results[0]!.detail).toContain("the app did not answer at http://app");
});

// A record a role account creates (a menu item) has no owner, so the account cleanup would miss it; the runner reports the
// id of everything a test creates, and the review's cleanup removes exactly those rows (riya's seeded-records list).
test("every record a test creates is reported for the cleanup", async () => {
  const created: string[] = [];
  const r = await runAcceptanceTests([nameKept], { apiUrl: api, appUrl: "http://unused", accounts, sleep: noSleep, onCreated: (id) => created.push(id) });
  expect(r.results[0]!.status).toBe("passed");
  expect(created.length).toBe(2);
  expect(created[1]).toMatch(/^o\d+$/);
});
