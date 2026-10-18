import { test, expect } from "bun:test";
import { blockingFindings, repairRequest, verifyAndRepair, runLiveCheck, type LiveCheckResult, type LiveFinding } from "./clone-verify.ts";

const f = (issue: string, file = "frontend/app/page.tsx"): LiveFinding => ({ file, issue });
const ok = (): LiveCheckResult => ({ ran: true, pass: true, findings: [], notChecked: [] });
const bad = (...issues: string[]): LiveCheckResult => ({ ran: true, pass: false, findings: issues.map((i) => f(i)), notChecked: [] });

// ── which findings stop a delivery ──────────────────────────────────────────
test("blockingFindings keeps what breaks the app and leaves out layout notes seen only on a phone", () => {
  const list = [
    f("[route-sweep] /plants/x (signed-in) threw an uncaught error: a is not iterable"),
    f("[route-sweep] / (signed-out, on a phone) is 40px wider than the phone screen, so the page scrolls sideways"),
    f("[route-sweep] /dashboard (signed-in) made a request that failed: GET http://localhost:3313/api/v1/x -> 500"),
  ];
  expect(blockingFindings(list).map((x) => x.issue.split(" ")[1])).toEqual(["/plants/x", "/dashboard"]);
});

// ── the text the editing steps are given ────────────────────────────────────
test("repairRequest tells the editing steps what testing the running app showed, with the pages and the evidence", () => {
  const text = repairRequest([f("[route-sweep] /plants/x (signed-in) threw an uncaught error: a is not iterable", "frontend/app/plants/[id]/page.tsx")]);
  expect(text).toContain("a is not iterable");
  expect(text).toContain("frontend/app/plants/[id]/page.tsx");
  expect(text.toLowerCase()).toContain("running app");
  expect(text.toLowerCase()).toContain("change nothing else");
});

// ── verify, repair, verify again ────────────────────────────────────────────
test("verifyAndRepair passes straight away when the live check is clean, and repairs nothing", async () => {
  let repairs = 0;
  const r = await verifyAndRepair({ liveCheck: async () => ok(), repair: async () => { repairs += 1; } });
  expect(r).toEqual({ pass: true, rounds: 0, findings: [], notChecked: [] });
  expect(repairs).toBe(0);
});

test("verifyAndRepair repairs what the live check found and passes when the next check is clean", async () => {
  const checks = [bad("[route-sweep] /x (signed-in) threw an uncaught error: boom"), ok()];
  const seen: string[][] = [];
  const r = await verifyAndRepair({ liveCheck: async () => checks.shift()!, repair: async (found) => { seen.push(found.map((x) => x.issue)); } });
  expect(r.pass).toBe(true);
  expect(r.rounds).toBe(1);
  expect(seen).toEqual([["[route-sweep] /x (signed-in) threw an uncaught error: boom"]]);
});

test("verifyAndRepair stops after the allowed repairs and returns what is still wrong", async () => {
  let repairs = 0;
  const r = await verifyAndRepair({ liveCheck: async () => bad("[route-sweep] /x (signed-in) threw an uncaught error: boom"), repair: async () => { repairs += 1; }, maxRepairs: 2 });
  expect(r.pass).toBe(false);
  expect(r.rounds).toBe(2);
  expect(repairs).toBe(2);
  expect(r.findings.length).toBe(1);
});

test("verifyAndRepair does not repair for layout-only notes, and still passes", async () => {
  let repairs = 0;
  const layoutOnly: LiveCheckResult = { ran: true, pass: false, findings: [f("[route-sweep] / (signed-out, on a phone) is 40px wider than the phone screen")], notChecked: [] };
  const r = await verifyAndRepair({ liveCheck: async () => layoutOnly, repair: async () => { repairs += 1; } });
  expect(r.pass).toBe(true);
  expect(repairs).toBe(0);
});

test("verifyAndRepair reports a failed repair instead of throwing, and does not check again after it", async () => {
  let checks = 0;
  const r = await verifyAndRepair({
    liveCheck: async () => { checks += 1; return bad("[route-sweep] /x (signed-in) threw an uncaught error: boom"); },
    repair: async () => { throw new Error("the rebuilt app did not start"); },
  });
  expect(r.pass).toBe(false);
  expect(r.repairError).toContain("did not start");
  expect(checks).toBe(1);
});

test("verifyAndRepair carries what the check could not look at through to the result", async () => {
  const r = await verifyAndRepair({ liveCheck: async () => ({ ran: true, pass: true, findings: [], notChecked: ["route sweep: /plants/[id] was not opened"] }), repair: async () => {} });
  expect(r.notChecked).toEqual(["route sweep: /plants/[id] was not opened"]);
});

// ── the live check itself, with fakes for the browser, the database and the account ──
function fakeDeps(log: string[], over: Record<string, unknown> = {}) {
  return {
    snapshot: (() => { let n = 0; return () => { log.push("snapshot"); return n++ === 0 ? { users: 0, plants: 0 } : { users: 0, plants: 0 }; }; })(),
    createAccount: async () => { log.push("account"); return { email: "verify+x@example.com", password: "p", token: "t" }; },
    seed: async () => { log.push("seed"); return { created: { plants: ["p1"] }, notSeeded: [] }; },
    authSmoke: async () => { log.push("auth"); return { ran: true, pass: true, findings: [], skippedReason: null }; },
    sweep: async () => { log.push("sweep"); return { ran: true, pass: true, findings: [] as LiveFinding[], notChecked: [] as string[], visited: 5, seeded: {} }; },
    purge: () => { log.push("purge"); },
    compare: (a: Record<string, number>, b: Record<string, number>) => { log.push("compare"); return Object.keys(b).filter((k) => b[k]! > (a[k] ?? 0)).map((k) => `${k}: left behind`); },
    endpoints: [{ method: "POST", path: "/api/v1/auth/sign-up" }],
    ...over,
  };
}
const OPTS = { buildDir: "E:/x", frontendDir: "E:/x/frontend", appUrl: "http://127.0.0.1:3210", backendUrl: "http://127.0.0.1:3311" };

test("runLiveCheck signs up a test account, seeds data, sweeps every page, then removes the test data", async () => {
  const log: string[] = [];
  const r = await runLiveCheck(OPTS, fakeDeps(log));
  expect(r.pass).toBe(true);
  expect(log).toEqual(["snapshot", "auth", "account", "seed", "sweep", "purge", "snapshot", "compare"]);
});

test("runLiveCheck reports a failed sign-up check and a failed sweep as findings", async () => {
  const log: string[] = [];
  const r = await runLiveCheck(OPTS, fakeDeps(log, {
    authSmoke: async () => ({ ran: true, pass: false, findings: ["sign-up did not reach the sign-in page"], skippedReason: null }),
    sweep: async () => ({ ran: true, pass: false, findings: [f("[route-sweep] /plants/x (signed-in) threw an uncaught error: a is not iterable")], notChecked: [], visited: 5, seeded: {} }),
  }));
  expect(r.pass).toBe(false);
  expect(r.findings.map((x) => x.issue)).toEqual(["[auth-smoke] sign-up did not reach the sign-in page", "[route-sweep] /plants/x (signed-in) threw an uncaught error: a is not iterable"]);
});

test("runLiveCheck always removes the test data, even when the sweep crashes, and says it could not finish", async () => {
  const log: string[] = [];
  const r = await runLiveCheck(OPTS, fakeDeps(log, { sweep: async () => { throw new Error("browser died"); } }));
  expect(log).toContain("purge");
  expect(r.pass).toBe(false);
  expect(r.findings[0]!.issue).toContain("browser died");
});

test("runLiveCheck reports test rows that are still in the database after the clean-up", async () => {
  const log: string[] = [];
  let n = 0;
  const r = await runLiveCheck(OPTS, fakeDeps(log, { snapshot: () => (n++ === 0 ? { users: 0 } : { users: 2 }) }));
  expect(r.pass).toBe(false);
  expect(r.findings.some((x) => x.issue.includes("users: left behind"))).toBe(true);
});

test("runLiveCheck says what it could not check when no test account can be made, instead of passing quietly", async () => {
  const log: string[] = [];
  const r = await runLiveCheck(OPTS, fakeDeps(log, { createAccount: async () => ({ reason: "the API contract has no register and login endpoints" }) }));
  expect(r.notChecked.join(" ")).toContain("register and login");
});
