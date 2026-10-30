import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planItemOf, classifyFinding, proveReviewFindings, adoptReviewTests, recordReviewNotes, recordReviewExamples, reviewerOf } from "./review-proof.ts";
import { planScope, saveAcceptanceTests, readAcceptanceTests, type AcceptanceTest } from "./acceptance-tests.ts";
import type { RunSummary } from "./acceptance-runner.ts";

// 2026-10-30 (team plan, stage 5): a review finding reaches a builder only with proof. A finding about what the customer
// asked for (SC, EP, ANS, ROLES) needs a reproduction — an acceptance test that fails on the running app; a finding about
// the rules every app keeps (SEC, INT, DESIGN) may instead be proven by its quoted code and the rule it breaks (the Chief
// AI's check judges those). A finding without proof goes to the notes. A reproduced finding becomes a permanent test.

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "proof-"));
  writeFileSync(join(dir, "spec.json"), JSON.stringify({ successCriteria: ["Customers sign up on /sign-up.", "Customers order on /order."] }));
  writeFileSync(join(dir, "api-contract.json"), JSON.stringify({ endpoints: [
    { method: "POST", path: "/api/v1/auth/sign-up", description: "Customer registration." },
    { method: "POST", path: "/api/v1/orders", description: "Place an order." },
    { method: "GET", path: "/api/v1/orders/:id", description: "One order." },
  ] }));
  writeFileSync(join(dir, "build-plan.json"), JSON.stringify({ buildPhases: [
    { name: "All", goal: "everything", pages: ["/sign-up", "/order"], endpoints: ["POST /api/v1/auth/sign-up", "POST /api/v1/orders", "GET /api/v1/orders/:id"], tables: [] },
  ] }));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const reproduction = { title: "an order shows the item's name at order time", as: "user", kind: "api", steps: [{ method: "GET", path: "/api/v1/orders/{{unique}}", expectStatus: 200, expectBody: [{ path: "items.0.name", equals: "Flat White" }] }] };

test("the plan item is read from the finding's bracket tag, and only an item the plan has counts", () => {
  const ids = planScope(dir).itemIds;
  expect(planItemOf({ file: "backend/src/routes/orders.ts", issue: "backend/src/routes/orders.ts:293 — [security/high] [int1]: the order joins menu_items" }, ids)).toBe("INT1");
  expect(planItemOf({ file: "x", issue: "[logic/high] [SC9] nothing" }, ids)).toBeNull();
  expect(planItemOf({ file: "x", issue: "[logic/high] no item named" }, ids)).toBeNull();
});

test("each finding is sorted by its proof", () => {
  const scope = planScope(dir);
  expect(classifyFinding({ file: "frontend/app", issue: "[route-sweep] /order answered 500" }, scope).kind).toBe("machine");
  expect(classifyFinding({ file: "", issue: "[logic/HIGH] review-incomplete: the reviewer did not finish" }, scope).kind).toBe("notice");
  expect(classifyFinding({ file: "backend/a.ts", issue: "backend/a.ts:3 — [logic/high] naming is unclear" }, scope)).toMatchObject({ kind: "note", reason: expect.stringContaining("names no item of the approved plan") });
  expect(classifyFinding({ file: "frontend/app/order/page.tsx", issue: "frontend/app/order/page.tsx:40 — [logic/high] [SC2] the order page never submits" }, scope)).toMatchObject({ kind: "note", reason: expect.stringContaining("needs a reproduction") });
  expect(classifyFinding({ file: "backend/src/routes/orders.ts", issue: "backend/src/routes/orders.ts:293 — [security/high] [INT1] the order joins menu_items for the name" }, scope)).toMatchObject({ kind: "code", planItem: "INT1" });
  const withTest = classifyFinding({ file: "backend/src/routes/orders.ts", issue: "backend/src/routes/orders.ts:293 — [logic/high] [SC2] the order shows the current name", reproduction }, scope);
  expect(withTest).toMatchObject({ kind: "test", planItem: "SC2" });
  expect((withTest as { test: AcceptanceTest }).test).toMatchObject({ planItem: "SC2", kind: "api", as: "user", phase: 1 });
});

test("a reproduction outside the plan is refused; a rule-of-every-app finding can still stand on its quoted code", () => {
  const scope = planScope(dir);
  const bad = { ...reproduction, steps: [{ method: "DELETE", path: "/api/v1/orders/1", expectStatus: 204 }] };
  expect(classifyFinding({ file: "backend/x.ts", issue: "backend/x.ts:1 — [logic/high] [SC2] orders cannot be deleted", reproduction: bad }, scope)).toMatchObject({ kind: "note", reason: expect.stringContaining("not in the approved API contract") });
  expect(classifyFinding({ file: "backend/x.ts", issue: "backend/x.ts:1 — [security/high] [INT1] history lost", reproduction: bad }, scope)).toMatchObject({ kind: "code", planItem: "INT1" });
});

const summary = (status: "passed" | "failed" | "not_checked"): RunSummary => ({ at: "t", results: [{ id: "x", phase: 1, planItem: "SC2", title: "t", status, detail: status === "failed" ? "items.0.name should equal \"Flat White\" but is \"Renamed\"" : "fine" }], passed: status === "passed" ? 1 : 0, failed: status === "failed" ? 1 : 0, notChecked: status === "not_checked" ? 1 : 0 });

test("the runner decides a reproduced finding: it fails on the app → confirmed; it passes → not reproduced, to the notes", async () => {
  const f = { file: "backend/src/routes/orders.ts", issue: "backend/src/routes/orders.ts:293 — [logic/high] [SC2] the order shows the current name", reproduction };
  const failing = await proveReviewFindings([f], dir, { reproduce: async () => summary("failed") });
  expect(failing.confirmedTests).toHaveLength(1);
  expect(failing.confirmedTests[0]!.detail).toContain("Renamed");
  const passing = await proveReviewFindings([f], dir, { reproduce: async () => summary("passed") });
  expect(passing.confirmedTests).toHaveLength(0);
  expect(passing.notes[0]!.reason).toContain("its reproduction passes on the running app");
});

test("a reproduction that cannot be run: a rule-of-every-app finding falls back to its code, any other goes to the notes", async () => {
  const sc = { file: "backend/x.ts", issue: "backend/x.ts:1 — [logic/high] [SC2] the order shows the current name", reproduction };
  const int = { file: "backend/x.ts", issue: "backend/x.ts:1 — [security/high] [INT1] the order shows the current name", reproduction };
  const r = await proveReviewFindings([sc, int], dir, { reproduce: async () => ({ ...summary("not_checked"), results: [{ ...summary("not_checked").results[0]!, id: "a" }, { ...summary("not_checked").results[0]!, id: "b" }] }) });
  expect(r.notes.map((n) => n.reason)).toEqual([expect.stringContaining("could not be run")]);
  expect(r.code.map((c) => c.planItem)).toEqual(["INT1"]);
});

test("a confirmed finding becomes a permanent acceptance test, numbered after the review's earlier ones", () => {
  saveAcceptanceTests(dir, { writtenAt: "t", tests: [], rejected: [], notWritten: [] });
  const t = classifyFinding({ file: "backend/x.ts", issue: "backend/x.ts:1 — [logic/high] [SC2] the order shows the current name", reproduction }, planScope(dir)) as { test: AcceptanceTest };
  expect(adoptReviewTests(dir, [t.test, t.test]).map((x) => x.id)).toEqual(["AT-R-1", "AT-R-2"]);
  expect(adoptReviewTests(dir, [t.test]).map((x) => x.id)).toEqual(["AT-R-3"]);
  const saved = readAcceptanceTests(dir)!.tests;
  expect(saved.map((x) => x.id)).toEqual(["AT-R-1", "AT-R-2", "AT-R-3"]);
  expect(saved[0]).toMatchObject({ source: "review", planItem: "SC2" });
});

test("findings without proof are kept as notes, never lost", () => {
  recordReviewNotes(dir, [{ finding: { file: "a", issue: "[logic/high] naming" }, reason: "names no item of the approved plan" }]);
  expect(existsSync(join(dir, "review-notes.jsonl"))).toBe(true);
  expect(JSON.parse(readFileSync(join(dir, "review-notes.jsonl"), "utf-8").trim())).toMatchObject({ file: "a", reason: "names no item of the approved plan" });
});

test("claim 4: a confirmed finding is an example the reviewer caught and the other two missed", async () => {
  expect(reviewerOf("x.ts:1 — [security/high] [INT1] y")).toBe("karan");
  expect(reviewerOf("x.ts:1 — [logic/high] [SC2] y")).toBe("navya");
  expect(reviewerOf("x.ts:1 — [performance/medium] [SEC6] y")).toBe("deepika");
  const bumps: Array<[string, string, boolean]> = [];
  await recordReviewExamples("p1", [{ finding: { file: "backend/x.ts", issue: "backend/x.ts:12 — [security/high] [INT1] the order joins menu_items" }, planItem: "INT1", evidence: "JOIN menu_items mi" }], {
    bumpExample: async (checker, d, caught) => void bumps.push([checker, d.id, caught]),
  });
  expect(bumps.map(([c, , caught]) => [c, caught])).toEqual([["karan", true], ["navya", false], ["deepika", false]]);
  expect(bumps[0]![1]).toMatch(/^review:p1:/);
  // A store that fails never stops the review.
  await recordReviewExamples("p1", [{ finding: { file: "a", issue: "[security/high] [INT1] x" }, planItem: "INT1" }], { bumpExample: async () => { throw new Error("db down"); } });
});
