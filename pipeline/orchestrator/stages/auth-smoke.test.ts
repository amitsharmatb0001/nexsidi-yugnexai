import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { runAuthSmokeTest, type BrowserLike } from "./auth-smoke.ts";

// Deterministic sign-up -> sign-in -> sign-out check that runs before the
// expensive live review. Built after project a034f90ba50e lost 3-4 full review
// rounds (20-60 min each) to auth that was broken in the UI while the backend
// worked: an /api proxy that returned 500, and a sign-in that left the user on
// the sign-in page.

const ENDPOINTS = [
  { method: "POST", path: "/api/v1/auth/sign-up" },
  { method: "POST", path: "/api/v1/auth/sign-in" },
  { method: "GET", path: "/api/v1/plants" },
];
const BASE = { appUrl: "http://localhost:3207", backendUrl: "http://localhost:3308", endpoints: ENDPOINTS, sleep: async () => {} };

interface FakeOpts {
  afterSignInPath?: string;
  hasSignOut?: boolean;
  cookieAfterSignOut?: boolean;
  links?: Array<{ text: string; href: string }>;
  // what the browser's network log shows (2026-10-04)
  requests?: Array<{ method: string; url: string; status: number }>;
}

// Answers each browser action from a tiny scripted state. evaluate()
// expressions carry a /*tag*/ prefix so the fake knows which step is asking.
function fakeBrowser(o: FakeOpts): BrowserLike & { calls: string[] } {
  const calls: string[] = [];
  let path = "/";
  let signedIn = false;
  return {
    calls,
    async send(action, args = {}) {
      calls.push(action === "evaluate" ? `evaluate:${String(args.expression).match(/^\/\*(\w+)\*\//)?.[1]}@${path}` : action);
      if (action === "navigate") { path = new URL(String(args.url)).pathname; return { status: 200 }; }
      if (action === "newSession") { signedIn = false; path = "/"; return { reset: true }; }
      if (action === "exists") return { exists: ["/sign-in", "/sign-up"].includes(path) };
      if (action === "currentUrl") return { url: `http://localhost:3207${path}` };
      if (action === "requests") return { requests: o.requests ?? [] };
      if (action === "evaluate") {
        const expr = String(args.expression);
        if (expr.startsWith("/*links*/")) return { value: o.links ?? [{ text: "Sign In", href: "/sign-in" }, { text: "Get Started", href: "/sign-up" }] };
        if (expr.startsWith("/*fill*/")) return { value: { filled: 2, hasEmail: true } };
        if (expr.startsWith("/*submit*/")) {
          if (path === "/sign-in") { signedIn = true; path = o.afterSignInPath ?? "/dashboard"; }
          return { value: true };
        }
        if (expr.startsWith("/*signout*/")) {
          if (o.hasSignOut === false) return { value: false };
          if (!o.cookieAfterSignOut) signedIn = false;
          path = "/sign-in";
          return { value: true };
        }
        if (expr.startsWith("/*cookie*/")) return { value: signedIn };
      }
      return {};
    },
    async close() {},
  };
}

const loginOk = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
const loginRejected = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
const loginBadShape = (async () => new Response("{}", { status: 400 })) as unknown as typeof fetch;

test("passes when sign-up creates the user, sign-in leaves the sign-in page and sign-out ends the session", async () => {
  const r = await runAuthSmokeTest({ ...BASE, browser: fakeBrowser({}), fetchFn: loginOk });
  expect(r).toEqual({ ran: true, pass: true, findings: [] });
});

test("fails when the user is still on the sign-in page after signing in", async () => {
  const r = await runAuthSmokeTest({ ...BASE, browser: fakeBrowser({ afterSignInPath: "/sign-in" }), fetchFn: loginOk });
  expect(r.ran).toBe(true);
  expect(r.pass).toBe(false);
  expect(r.findings[0]).toContain("still on the sign-in page");
});

test("fails when the sign-up form did not create the account", async () => {
  const r = await runAuthSmokeTest({ ...BASE, browser: fakeBrowser({}), fetchFn: loginRejected });
  expect(r.pass).toBe(false);
  expect(r.findings[0]).toContain("sign-up form");
  expect(r.findings[0]).toContain("401");
});

test("fails when Sign Out leaves the token cookie set", async () => {
  const r = await runAuthSmokeTest({ ...BASE, browser: fakeBrowser({ cookieAfterSignOut: true }), fetchFn: loginOk });
  expect(r.pass).toBe(false);
  expect(r.findings[0]).toContain("Sign Out");
});

test("a login API that rejects the request shape (400) is not judged — skipped, never failed", async () => {
  const r = await runAuthSmokeTest({ ...BASE, browser: fakeBrowser({}), fetchFn: loginBadShape });
  expect(r).toMatchObject({ ran: false, pass: true });
});

test("an app with no sign-out control still passes the sign-up and sign-in checks", async () => {
  const r = await runAuthSmokeTest({ ...BASE, browser: fakeBrowser({ hasSignOut: false }), fetchFn: loginOk });
  expect(r).toEqual({ ran: true, pass: true, findings: [] });
});

test("finds auth pages through the fallback paths when the landing page has no auth links", async () => {
  const r = await runAuthSmokeTest({ ...BASE, browser: fakeBrowser({ links: [] }), fetchFn: loginOk });
  expect(r).toEqual({ ran: true, pass: true, findings: [] });
});

test("skips (never fails) an app without sign-up and sign-in endpoints", async () => {
  const browser = fakeBrowser({});
  const r = await runAuthSmokeTest({ ...BASE, endpoints: [{ method: "GET", path: "/api/items" }], browser, fetchFn: loginOk });
  expect(r).toMatchObject({ ran: false, pass: true });
  expect(browser.calls).toEqual([]);
});

test("fails open when the browser throws", async () => {
  const throwing: BrowserLike = { async send() { throw new Error("browser worker timed out"); }, async close() {} };
  const r = await runAuthSmokeTest({ ...BASE, browser: throwing, fetchFn: loginOk });
  expect(r).toMatchObject({ ran: false, pass: true });
  expect(r.skippedReason).toContain("browser worker timed out");
});

test("Stage 6 runs the smoke test before the expensive review, behind an off switch", () => {
  const src = readFileSync(new URL("./stage6-deployment.ts", import.meta.url), "utf-8");
  const fn = src.slice(src.indexOf("async function runRealLiveRetest"));
  expect(fn.indexOf("runAuthSmokeTest(")).toBeGreaterThan(-1);
  expect(fn.indexOf("runAuthSmokeTest(")).toBeLessThan(fn.indexOf("runStage5("));
  expect(fn).toContain('process.env.AUTH_SMOKE_TEST !== "off"');
});


// Live check on 2026-10-01: with the old router.push sign-in restored, this
// test still PASSED — the current header shows no Dashboard link while signed
// out, so nothing prefetched /dashboard and the bug stayed hidden. A real
// browser prefetches visible links; the test now does the same before signing
// in, so the latent bug is caught whatever the header shows.
test("before signing in, it prefetches the app's links and /dashboard like a real browser", async () => {
  const browser = fakeBrowser({});
  await runAuthSmokeTest({ ...BASE, browser, fetchFn: loginOk });
  const prefetch = browser.calls.indexOf("evaluate:prefetch@/sign-in");
  const signInSubmit = browser.calls.indexOf("evaluate:submit@/sign-in");
  expect(prefetch).toBeGreaterThan(-1);
  expect(prefetch).toBeLessThan(signInSubmit);
});

// 2026-10-04 (Ledgerly run 4, overnight): the check waited a fixed 4 seconds
// and took a 401 as "the form is broken". During a redeploy the form's request
// had simply not finished; the same check passed against the same app later,
// and the builder was sent to fix a working form all night. It now waits for
// the account (up to 30 s) and, if it never appears, says what the browser's
// own request did — never a verdict from timing alone.
test("waits for the account instead of judging after a fixed delay", async () => {
  let calls = 0;
  const slowThenOk = (async () => new Response("{}", { status: ++calls < 4 ? 401 : 200 })) as unknown as typeof fetch;
  const r = await runAuthSmokeTest({ ...BASE, browser: fakeBrowser({}), fetchFn: slowThenOk });
  expect(r).toEqual({ ran: true, pass: true, findings: [] });
  expect(calls).toBeGreaterThanOrEqual(4);
});

test("a failure says what the form's own request did", async () => {
  const sent = [{ method: "POST", url: "http://localhost:3308/api/v1/auth/sign-up", status: 500 }];
  const r = await runAuthSmokeTest({ ...BASE, browser: fakeBrowser({ requests: sent }), fetchFn: loginRejected });
  expect(r.pass).toBe(false);
  expect(r.findings[0]).toContain("returned 500");
});

test("a form that sent no sign-up request says so", async () => {
  const r = await runAuthSmokeTest({ ...BASE, browser: fakeBrowser({ requests: [] }), fetchFn: loginRejected });
  expect(r.findings[0]).toContain("sent no request");
});

// 2026-10-25 (brewline2): the smoke test's sign-in call gave up on a 429 from the app's own limiter ("login API answered 429 —
// cannot judge the sign-up form"), so the sign-up form went unchecked. A 429 is waited out for the Retry-After and the call repeated.
test("sign-in waits out a 429 for the time the app says, then goes on", async () => {
  const { signInWaitingOutRateLimit } = await import("./auth-smoke.ts");
  const waits: number[] = [];
  const answers = [new Response("{}", { status: 429, headers: { "retry-after": "5" } }), new Response("{}", { status: 200 })];
  const res = await signInWaitingOutRateLimit((async () => answers.shift()!) as unknown as typeof fetch, "http://x/login", "a@example.com", "pw", async (ms) => { waits.push(ms); });
  expect(res.status).toBe(200);
  expect(waits).toEqual([6000]);
  let n = 0;
  const always = await signInWaitingOutRateLimit((async () => { n++; return new Response("{}", { status: 429 }); }) as unknown as typeof fetch, "http://x/login", "a", "b", async () => {});
  expect(always.status).toBe(429);
  expect(n).toBe(3);
});
