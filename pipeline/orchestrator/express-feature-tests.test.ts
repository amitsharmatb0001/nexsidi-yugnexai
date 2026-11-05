import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFeatureTests, featureTestPrompt, runFeatureTests, seedFailed, type FeatureDeps } from "./express-feature-tests.ts";
import type { AcceptanceTest } from "./acceptance-tests.ts";
import type { RunSummary, TestResult } from "./acceptance-runner.ts";

// 2026-11-05 (Express Build on tough changes): recurring invoices, shared households and loyalty points were all delivered, each passed the
// live check, and in each the feature did not do what was asked. The live check proves that pages and records work. These tests come from
// the customer's own words, from a reader who did not build the change, and the build is done when they pass on the running app.
const routes = [{ method: "POST", path: "/api/v1/orders" }, { method: "GET", path: "/api/v1/loyalty/me" }, { method: "POST", path: "/api/v1/staff/orders/:id/redeem" }];
const good = { title: "100 points take 5 dollars off", as: "staff", kind: "api", steps: [{ method: "POST", path: "/api/v1/staff/orders/{{id}}/redeem", body: { points: 100 }, expectStatus: 200, expectBody: [{ path: "order.discount_amount", equals: 5 }] }] };

test("the tester is given the customer's words and is told to test those, not the code", () => {
  const p = featureTestPrompt("100 points takes 5 dollars off", routes, "code here");
  expect(p).toContain("100 points takes 5 dollars off");
  expect(p).toContain("POST /api/v1/staff/orders/:id/redeem");
  expect(p).toMatch(/what the customer asked/i);
});

test("tests are read from the model's answer, with ids", () => {
  const { tests } = parseFeatureTests("```json\n" + JSON.stringify([good]) + "\n```", routes);
  expect(tests.length).toBe(1);
  expect(tests[0]!.id).toBe("FT-1");
  expect(tests[0]!.planItem).toBe("REQUEST");
});

test("a test using a route the app does not have is left out, and said so: it would send a builder after nothing", () => {
  const bad = { ...good, steps: [{ method: "GET", path: "/api/v1/nothing", expectStatus: 200 }] };
  const { tests, dropped } = parseFeatureTests(JSON.stringify([good, bad]), routes);
  expect(tests.length).toBe(1);
  expect(dropped[0]).toContain("/api/v1/nothing");
});

test("an unreadable answer gives no tests", () => {
  expect(parseFeatureTests("I cannot do that", routes).tests).toEqual([]);
});

const result = (t: AcceptanceTest, status: TestResult["status"]): TestResult => ({ id: t.id, phase: 1, planItem: "REQUEST", title: t.title, status, detail: `${t.title} ${status}` });
const summary = (results: TestResult[]): RunSummary => ({ at: "t", results, passed: results.filter((r) => r.status === "passed").length, failed: results.filter((r) => r.status === "failed").length, notChecked: results.filter((r) => r.status === "not_checked").length });

function deps(passOnRun: number): { d: FeatureDeps; repairs: string[]; runs: () => number } {
  let runs = 0;
  const repairs: string[] = [];
  return {
    repairs,
    runs: () => runs,
    d: {
      routes: () => routes,
      code: () => "code",
      chat: async () => JSON.stringify([good]),
      run: async (tests) => {
        runs++;
        return summary(tests.map((t) => result(t, runs >= passOnRun ? "passed" : "failed")));
      },
      repair: async (request) => void repairs.push(request),
    },
  };
}

test("a build whose feature does what was asked passes at once", async () => {
  const x = deps(1);
  const r = await runFeatureTests("the request", x.d);
  expect(r.status).toBe("passed");
  expect(x.repairs).toEqual([]);
});

test("a failing test goes to a repair with the customer's words, and the tests run again", async () => {
  const x = deps(2);
  const r = await runFeatureTests("100 points takes 5 dollars off", x.d);
  expect(r.status).toBe("passed");
  expect(r.rounds).toBe(1);
  expect(x.repairs[0]).toContain("100 points takes 5 dollars off");
  expect(x.repairs[0]).toContain("failed");
});

test("the tests stay the same across repairs: a repair cannot change what it is judged by", async () => {
  const x = deps(2);
  let writes = 0;
  const chat = x.d.chat;
  x.d.chat = async (p) => (writes++, chat(p));
  await runFeatureTests("the request", x.d);
  expect(writes).toBe(1);
});

test("still failing after the repairs is failing, with what failed", async () => {
  const x = deps(99);
  const r = await runFeatureTests("the request", x.d, { maxRepairs: 2 });
  expect(r.status).toBe("failing");
  expect(x.repairs.length).toBe(2);
  expect(r.failing[0]).toContain("100 points");
});

test("no usable test is not a pass: it is not checked, and it says so", async () => {
  const x = deps(1);
  x.d.chat = async () => "no";
  const r = await runFeatureTests("the request", x.d);
  expect(r.status).toBe("not_checked");
});

test("a test that could not run is reported, and sends nobody to repair anything", async () => {
  const x = deps(1);
  x.d.run = async (tests) => summary(tests.map((t) => result(t, "not_checked")));
  const r = await runFeatureTests("the request", x.d);
  expect(r.status).toBe("not_checked");
  expect(x.repairs).toEqual([]);
});

// The loyalty copy was delivered with no menu and no staff: the seed ran once, before the database was ready.
test("an app with starter data code and an empty public list had its seed fail", () => {
  expect(seedFailed({ hasSeedCode: true, listCounts: { "/api/v1/menu": 0 } })).toEqual(["/api/v1/menu"]);
  expect(seedFailed({ hasSeedCode: true, listCounts: { "/api/v1/menu": 14 } })).toEqual([]);
  // An older app with no seed code may start empty on purpose.
  expect(seedFailed({ hasSeedCode: false, listCounts: { "/api/v1/menu": 0 } })).toEqual([]);
});

test("the Express Build route runs the feature tests, the seed check and the owner's sign-in before it says done", () => {
  const src = readFileSync(join(import.meta.dir, "../../apps/api/src/routes/projects.ts"), "utf-8");
  const done = src.indexOf('status: "done", appUrl, updatedAt');
  for (const step of ["runFeatureTests(", "seedFailed(", "provisionOwnerLoginFor("]) {
    const at = src.indexOf(step);
    expect({ step, before: at > 0 && at < done }).toEqual({ step, before: true });
  }
});

test("the backend pass gets the customer's own words", () => {
  const src = readFileSync(join(import.meta.dir, "../../apps/api/src/routes/projects.ts"), "utf-8");
  expect(src).toContain("customerRequest: changes");
});

// 2026-11-05 (retest): the loyalty build's tester answer could not be used at all, and the households tests ran as "staff" in an app with no staff.
test("an answer cut off part way still gives its finished tests", () => {
  const whole = JSON.stringify(good);
  const { tests } = parseFeatureTests("[" + whole + "," + whole + ',{"title":"cut off","as":"staff","kind":"api","steps":[{"method":"PO', routes);
  expect(tests.length).toBe(2);
});

test("a test as someone the app does not have is left out, and said so", () => {
  const { tests, dropped } = parseFeatureTests(JSON.stringify([good, { ...good, as: "user" }]), routes, ["anyone", "user"]);
  expect(tests.map((t) => t.as)).toEqual(["user"]);
  expect(dropped[0]).toContain("staff");
  const stepAs = { ...good, as: "user", steps: [{ ...good.steps[0], as: "staff" }] };
  expect(parseFeatureTests(JSON.stringify([stepAs]), routes, ["anyone", "user"]).tests).toEqual([]);
});

test("the tester is told who the app has", () => {
  const p = featureTestPrompt("the request", routes, "code", ["anyone", "user"]);
  expect(p).toContain('"anyone", "user"');
  expect(p).not.toContain('such as "staff"');
});

test("an unusable answer is asked for once more", async () => {
  const x = deps(1);
  let calls = 0;
  x.d.chat = async () => (++calls === 1 ? "no" : JSON.stringify([good]));
  const r = await runFeatureTests("the request", x.d);
  expect(calls).toBe(2);
  expect(r.status).toBe("passed");
});

test("the route does not call an app done when its tests did not run", () => {
  const src = readFileSync(join(import.meta.dir, "../../apps/api/src/routes/projects.ts"), "utf-8");
  expect(src).toMatch(/featureTests\.status (===|!==) "(not_checked|passed)"/);
  expect(src).toContain("express_build_request_not_checked");
});

test("a mismatch between the two layers goes to one repair before the build is given up", () => {
  const src = readFileSync(join(import.meta.dir, "../../apps/api/src/routes/projects.ts"), "utf-8");
  const at = src.indexOf("checkCrossLayerContract({");
  expect(src.slice(at, at + 1600)).toContain("applyCloneChanges(");
});
