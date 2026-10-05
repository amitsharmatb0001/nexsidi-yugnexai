import { test, expect } from "bun:test";
import { discoverRoutes, routeMatches, linkTargetsMissing, judgeVisit, runRouteSweep, type Visit } from "./route-sweep.ts";

// 2026-10-05 (Ledgerly run 4): the live review's agents only visit the pages they choose to click through.
// A wrong route, a dead link, a failing request or a console error on a page nobody opened was invisible to
// every real-browser step. The sweep opens EVERY page route in a real browser, signed out and signed in, and
// states what it saw. These tests cover the judgement (pure) and the flow (with a fake browser).

test("discoverRoutes turns app/ page files into routes, drops route groups, keeps dynamic segments", () => {
  const r = discoverRoutes([
    "app/page.tsx",
    "app/dashboard/page.tsx",
    "app/(marketing)/pricing/page.tsx",
    "app/invoices/[id]/page.tsx",
    "app/invoices/new/page.tsx",
    "app/api/health/route.ts",
    "app/layout.tsx",
    "app/@modal/login/page.tsx",
    "components/x/page.tsx",
  ]);
  expect(r.pages.map((p) => p.route).sort()).toEqual(["/", "/dashboard", "/invoices/[id]", "/invoices/new", "/pricing"]);
  expect(r.pages.find((p) => p.route === "/pricing")!.file).toBe("app/(marketing)/pricing/page.tsx");
  expect(r.handlers).toEqual(["/api/health"]);
});

test("routeMatches matches dynamic and catch-all segments", () => {
  expect(routeMatches("/invoices/[id]", "/invoices/42")).toBe(true);
  expect(routeMatches("/invoices/[id]", "/invoices/new")).toBe(true);
  expect(routeMatches("/invoices/[id]", "/invoices")).toBe(false);
  expect(routeMatches("/docs/[...slug]", "/docs/a/b")).toBe(true);
  expect(routeMatches("/", "/")).toBe(true);
});

test("linkTargetsMissing finds internal links that match no page, and ignores api, assets, anchors and external links", () => {
  const routes = ["/", "/dashboard", "/invoices/[id]"];
  const missing = linkTargetsMissing(
    [
      { href: "/dashboard", from: "/" },
      { href: "/invoices/7", from: "/dashboard" },
      { href: "/pricing", from: "/" },
      { href: "/pricing?x=1#top", from: "/dashboard" },
      { href: "/api/v1/export", from: "/" },
      { href: "/logo.svg", from: "/" },
      { href: "https://example.org/x", from: "/" },
      { href: "#features", from: "/" },
      { href: "mailto:a@b.c", from: "/" },
    ],
    routes,
    ["/api/health"],
  );
  expect(missing).toEqual([{ href: "/pricing", from: ["/", "/dashboard"] }]);
});

const visit = (over: Partial<Visit> = {}): Visit => ({
  route: "/dashboard", auth: "signed-in", status: 200, finalPath: "/dashboard", bodyText: "Dashboard with enough words in it to count as a page", consoleErrors: [], pageErrors: [], failedRequests: [], loadError: null, ...over,
});

test("judgeVisit passes a healthy page", () => {
  expect(judgeVisit(visit())).toEqual([]);
});

test("judgeVisit reports the real problems with the evidence", () => {
  expect(judgeVisit(visit({ status: 500 }))[0]).toContain("HTTP 500");
  expect(judgeVisit(visit({ bodyText: "" }))[0]).toContain("blank");
  expect(judgeVisit(visit({ bodyText: "404 This page could not be found." }))[0]).toContain("not found");
  expect(judgeVisit(visit({ bodyText: "404 -\n\nPage Not Found\n\nThe page is gone" }))[0]).not.toContain("\n");
  expect(judgeVisit(visit({ pageErrors: ["TypeError: x is undefined"] }))[0]).toContain("TypeError: x is undefined");
  expect(judgeVisit(visit({ consoleErrors: ["Hydration failed because the server rendered text"] }))[0]).toContain("Hydration failed");
  expect(judgeVisit(visit({ failedRequests: [{ method: "GET", url: "http://localhost:3300/api/v1/dashboard", status: 404 }] }))[0]).toContain("GET http://localhost:3300/api/v1/dashboard -> 404");
  expect(judgeVisit(visit({ loadError: "Timeout 20000ms exceeded" }))[0]).toContain("did not load");
});

test("judgeVisit ignores noise: favicon, aborted prefetches, the browser's own 'Failed to load resource' line, and 401 when signed out", () => {
  expect(judgeVisit(visit({
    consoleErrors: ["Failed to load resource: the server responded with a status of 404 ()"],
    failedRequests: [
      { method: "GET", url: "http://localhost:3200/favicon.ico", status: 404 },
      { method: "GET", url: "http://localhost:3200/_next/data/x.json", status: 0, failure: "net::ERR_ABORTED" },
    ],
  }))).toEqual([]);
  expect(judgeVisit(visit({ auth: "signed-out", failedRequests: [{ method: "GET", url: "http://localhost:3300/api/v1/me", status: 401 }] }))).toEqual([]);
  expect(judgeVisit(visit({ auth: "signed-in", failedRequests: [{ method: "GET", url: "http://localhost:3300/api/v1/me", status: 401 }] }))).not.toEqual([]);
});

// ---- the flow, with a fake browser ----
type FakePage = { status: number; text: string; links?: string[]; consoleErrors?: string[]; failed?: Array<{ method: string; url: string; status: number }> };

function fakeBrowser(pages: Record<string, FakePage>) {
  const calls: string[] = [];
  let current = "/";
  let cookieSet = false;
  let consoleErrors: string[] = [];
  let failed: Array<{ method: string; url: string; status: number }> = [];
  const protectedRoutes = new Set(["/dashboard"]);
  return {
    calls,
    async send(action: string, args: Record<string, unknown> = {}): Promise<unknown> {
      calls.push(action);
      if (action === "newSession") { cookieSet = false; consoleErrors = []; failed = []; return { reset: true }; }
      if (action === "navigate") {
        const path = new URL(String(args.url)).pathname;
        let target = path;
        if (protectedRoutes.has(path) && !cookieSet) target = "/sign-in";
        current = target;
        const pg = pages[target] ?? { status: 404, text: "404 This page could not be found." };
        consoleErrors.push(...(pg.consoleErrors ?? []));
        failed.push(...(pg.failed ?? []));
        return { status: pg.status, url: `http://app${target}`, finalUrl: `http://app${target}` };
      }
      if (action === "evaluate") {
        const expr = String(args.expression);
        if (expr.includes("document.cookie")) { cookieSet = true; return { value: null }; }
        const pg = pages[current] ?? { status: 404, text: "404 This page could not be found.", links: [] };
        if (expr.includes("/*page*/")) return { value: { text: pg.text, links: pg.links ?? [] } };
        return { value: null };
      }
      if (action === "consoleErrors") return { consoleErrors: [...consoleErrors], pageErrors: [] };
      if (action === "failedRequests") return { failed: [...failed] };
      if (action === "screenshot") return { path: args.path };
      return {};
    },
    async close() {},
  };
}

const okFetch = (async (url: string) => {
  const u = String(url);
  if (u.endsWith("/register")) return new Response(JSON.stringify({ success: true, data: { token: "t1" } }), { status: 201 });
  if (u.endsWith("/login")) return new Response(JSON.stringify({ success: true, data: { token: "t2" } }), { status: 200 });
  return new Response("{}", { status: 404 });
}) as unknown as typeof fetch;

const baseOpts = (browser: ReturnType<typeof fakeBrowser>, routeFiles: string[]) => ({
  appUrl: "http://app",
  backendUrl: "http://api",
  endpoints: [{ method: "POST", path: "/api/v1/auth/register" }, { method: "POST", path: "/api/v1/auth/login" }],
  routeFiles,
  browser,
  fetchFn: okFetch,
  screenshotDir: null,
});

test("runRouteSweep visits every static route signed out and signed in, and passes a healthy app", async () => {
  const b = fakeBrowser({
    "/": { status: 200, text: "Home page text with plenty of words to be a real page", links: ["/dashboard", "/sign-in"] },
    "/sign-in": { status: 200, text: "Sign in to your account please" },
    "/dashboard": { status: 200, text: "Dashboard content for the signed in user, many words" },
  });
  const r = await runRouteSweep(baseOpts(b, ["app/page.tsx", "app/sign-in/page.tsx", "app/dashboard/page.tsx"]));
  expect(r.ran).toBe(true);
  expect(r.pass).toBe(true);
  expect(r.findings).toEqual([]);
  expect(b.calls.filter((c) => c === "newSession")).toHaveLength(2);
  expect(r.visited).toBe(6);
});

test("runRouteSweep reports a broken page with its route file, and a dead link", async () => {
  const b = fakeBrowser({
    "/": { status: 200, text: "Home page text with plenty of words to be a real page", links: ["/dashboard", "/pricing"] },
    "/sign-in": { status: 200, text: "Sign in to your account please" },
    "/dashboard": { status: 200, text: "Dashboard content for the signed in user, many words", failed: [{ method: "GET", url: "http://api/api/v1/dashboard", status: 404 }] },
  });
  const r = await runRouteSweep(baseOpts(b, ["app/page.tsx", "app/sign-in/page.tsx", "app/dashboard/page.tsx"]));
  expect(r.pass).toBe(false);
  const dash = r.findings.find((f) => f.file === "frontend/app/dashboard/page.tsx" && f.issue.includes("GET"))!;
  expect(dash.issue).toContain("GET http://api/api/v1/dashboard -> 404");
  const link = r.findings.find((f) => f.issue.includes("/pricing"))!;
  expect(link.file).toBe("frontend/app/page.tsx");
});

test("runRouteSweep lists dynamic routes it could not open instead of guessing an id", async () => {
  const b = fakeBrowser({ "/": { status: 200, text: "Home page text with plenty of words to be a real page" } });
  const r = await runRouteSweep(baseOpts(b, ["app/page.tsx", "app/invoices/[id]/page.tsx"]));
  expect(r.notChecked.join("\n")).toContain("/invoices/[id]");
});

test("runRouteSweep says 'not checked' for the signed-in pass when no test account can be created", async () => {
  const b = fakeBrowser({ "/": { status: 200, text: "Home page text with plenty of words to be a real page" } });
  const failFetch = (async () => new Response(JSON.stringify({ success: false, error: "Validation failed: name is required" }), { status: 400 })) as unknown as typeof fetch;
  const r = await runRouteSweep({ ...baseOpts(b, ["app/page.tsx"]), fetchFn: failFetch });
  expect(r.pass).toBe(true);
  expect(r.notChecked.join("\n")).toContain("signed-in");
  expect(r.notChecked.join("\n")).toContain("Validation failed");
});

// /invoices/new matches the pattern /invoices/[id] but is its own page: a link to it is not a real example of [id].
test("runRouteSweep does not count a link to a static page as an example of a dynamic route", async () => {
  const b = fakeBrowser({
    "/": { status: 200, text: "Home page text with plenty of words to be a real page", links: ["/invoices/new"] },
    "/invoices/new": { status: 200, text: "New invoice form with plenty of words to be a page" },
  });
  const r = await runRouteSweep(baseOpts(b, ["app/page.tsx", "app/invoices/new/page.tsx", "app/invoices/[id]/page.tsx"]));
  expect(r.notChecked.join("\n")).toContain("/invoices/[id]");
});

// 2026-10-05 (Amit): sample data for every resource, so detail pages have a real id to open.
test("runRouteSweep opens a detail page with a real sample id when sample data was created", async () => {
  const b = fakeBrowser({
    "/": { status: 200, text: "Home page text with plenty of words to be a real page" },
    "/clients/c1": { status: 200, text: "Client detail page for Sample clients 1 with enough words" },
  });
  const r = await runRouteSweep({
    ...baseOpts(b, ["app/page.tsx", "app/clients/[id]/page.tsx"]),
    seed: async () => ({ created: { clients: ["c1", "c2"] }, notSeeded: [] }),
  });
  expect(r.pass).toBe(true);
  expect(r.notChecked.join("\n")).not.toContain("/clients/[id]");
  expect(r.visited).toBe(3);
  expect(r.seeded).toEqual({ clients: ["c1", "c2"] });
});

test("runRouteSweep reports the sample data it could not create, and a broken detail page is a finding", async () => {
  const b = fakeBrowser({
    "/": { status: 200, text: "Home page text with plenty of words to be a real page" },
    "/clients/c1": { status: 500, text: "Application error: a server-side exception has occurred" },
  });
  const r = await runRouteSweep({
    ...baseOpts(b, ["app/page.tsx", "app/clients/[id]/page.tsx", "app/invoices/[id]/page.tsx"]),
    seed: async () => ({ created: { clients: ["c1"] }, notSeeded: ["sample data: invoices #1 was not created (POST /api/v1/invoices answered 400: total must be positive)"] }),
  });
  expect(r.pass).toBe(false);
  expect(r.findings.some((f) => f.file === "frontend/app/clients/[id]/page.tsx" && f.issue.includes("HTTP 500"))).toBe(true);
  expect(r.notChecked.join("\n")).toContain("invoices #1 was not created");
  expect(r.notChecked.join("\n")).toContain("/invoices/[id]");
});

// 2026-10-05 (Amit): one test account serves the sweep AND the review agents. The stage creates it first and hands
// it to the sweep, which must not register a second one.
test("runRouteSweep uses the account it is given instead of registering a new one", async () => {
  const b = fakeBrowser({
    "/": { status: 200, text: "Home page text with plenty of words to be a real page" },
    "/sign-in": { status: 200, text: "Sign in to your account please" },
    "/dashboard": { status: 200, text: "Dashboard content for the signed in user, many words" },
  });
  const urls: string[] = [];
  const spyFetch = (async (url: string) => { urls.push(String(url)); return new Response("{}", { status: 404 }); }) as unknown as typeof fetch;
  const r = await runRouteSweep({ ...baseOpts(b, ["app/page.tsx", "app/sign-in/page.tsx", "app/dashboard/page.tsx"]), fetchFn: spyFetch, session: { token: "given-token" } });
  expect(r.pass).toBe(true);
  expect(urls).toEqual([]);
  expect(r.notChecked.join("\n")).not.toContain("signed-in");
});

test("createReviewAccount registers an account on the reserved test domain and returns its details and token", async () => {
  const { createReviewAccount } = await import("./route-sweep.ts");
  const a = await createReviewAccount({ backendUrl: "http://api", endpoints: [{ method: "POST", path: "/api/v1/auth/register" }, { method: "POST", path: "/api/v1/auth/login" }], fetchFn: okFetch });
  expect("token" in a).toBe(true);
  if ("token" in a) {
    expect(a.email).toMatch(/^verify\+review\d+@example\.com$/);
    expect(a.password.length).toBeGreaterThan(10);
    expect(a.token).toBe("t2");
  }
});
