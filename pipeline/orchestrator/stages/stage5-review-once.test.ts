import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReviewOnceWithDeps, type ReviewOnceDeps } from "./stage5-review-once.ts";
import { readAcceptanceTests, saveAcceptanceTests } from "../acceptance-tests.ts";
import type { RunSummary } from "../acceptance-runner.ts";
import type { BuildPlan } from "../../../agents/arjun/src/index.ts";
import type { Stage4Result } from "./stage4-multi-agent-dev.ts";

// 2026-10-30 (team plan, stage 5): the three reviewers run ONCE, on a build whose acceptance tests pass. Their findings
// reach a builder only with proof (../review-proof.ts); a reproduced finding becomes a permanent acceptance test that the
// acceptance gate fixes (a fix is done when its test passes); there is no second review round. Stand-in steps: no model.

let root = "";
let dir = "";
const plan = { projectId: "p1" } as unknown as BuildPlan;
const s4 = {} as Stage4Result;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "once-"));
  process.env.BUILD_DIR = root;
  dir = join(root, "p1");
  mkdirSync(join(dir, "backend", "src", "routes"), { recursive: true });
  writeFileSync(join(dir, "spec.json"), JSON.stringify({ successCriteria: ["Customers sign up on /sign-up.", "Customers order on /order."] }));
  writeFileSync(join(dir, "api-contract.json"), JSON.stringify({ endpoints: [
    { method: "POST", path: "/api/v1/orders", description: "Place an order." },
    { method: "GET", path: "/api/v1/orders/:id", description: "One order." },
  ] }));
  writeFileSync(join(dir, "build-plan.json"), JSON.stringify({ buildPhases: [{ name: "All", goal: "all", pages: ["/order"], endpoints: ["POST /api/v1/orders", "GET /api/v1/orders/:id"], tables: [] }] }));
  writeFileSync(join(dir, "backend", "src", "routes", "orders.ts"), "router.get('/:id', async (req, res) => {\n  const rows = await db.query('SELECT mi.name FROM order_items oi JOIN menu_items mi ON mi.id = oi.menu_item_id');\n});\n");
  saveAcceptanceTests(dir, { writtenAt: "t", tests: [], rejected: [], notWritten: [] });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.BUILD_DIR;
});

const reproduction = { title: "an order shows the item's name at order time", as: "user", kind: "api", steps: [{ method: "GET", path: "/api/v1/orders/1", expectStatus: [200], expectBody: [{ path: "items.0.name", equals: "Flat White" }] }] };
const reproduced = { file: "backend/src/routes/orders.ts", issue: "backend/src/routes/orders.ts:2 — [logic/HIGH] history: [SC2] the order shows the item's current name", reproduction };
const noProof = { file: "backend/src/routes/orders.ts", issue: "backend/src/routes/orders.ts:1 — [logic/MEDIUM] naming: [SC2] the route is hard to read" };
const codeFinding = { file: "backend/src/routes/orders.ts", issue: "backend/src/routes/orders.ts:2 — [security/HIGH] [INT1] the order joins menu_items for the name", evidence: "JOIN menu_items mi" };
const machine = { file: "backend/src/routes/orders.ts", issue: "[route-sweep] GET /api/v1/orders/1 answered 500" };

const failed = (n: number): RunSummary => ({ at: "t", results: Array.from({ length: n }, (_, i) => ({ id: `x${i}`, phase: 1, planItem: "SC2", title: "t", status: "failed" as const, detail: 'items.0.name should equal "Flat White" but is "Renamed"' })), passed: 0, failed: n, notChecked: 0 });

function standIns(over: Partial<ReviewOnceDeps> = {}) {
  const calls: string[] = [];
  const deps: ReviewOnceDeps = {
    runStage5: async () => (calls.push("review"), { pass: false, findings: [reproduced, noProof, codeFinding, machine] }),
    reproduce: async (tests) => (calls.push(`reproduce ${tests.length}`), failed(tests.length)),
    gate: async () => (calls.push("gate"), { status: "passed" }),
    fixShubham: async (_p, f) => (calls.push(`fix shubham ${f.length}`), { success: true, filesWritten: ["src/routes/orders.ts"] }),
    fixAanya: async (_p, f) => (calls.push(`fix aanya ${f.length}`), { success: true, filesWritten: [] }),
    chiefChat: async () => JSON.stringify([{ id: 1, verdict: "fix", plan_item: "INT1", text: "the order joins menu_items for the name" }]),
    recordExamples: async (c) => void calls.push(`examples ${c.length}`),
    ...over,
  };
  return { deps, calls };
}

test("the reviewers run once; proven findings are fixed, a reproduced one becomes a test the gate fixes", async () => {
  const { deps, calls } = standIns();
  const r = await runReviewOnceWithDeps("p1", plan, s4, deps);
  expect(r).toMatchObject({ pass: true, iterations: 1, stuck: false });
  expect(calls.filter((c) => c === "review")).toHaveLength(1);
  expect(calls).toEqual(["review", "reproduce 1", "examples 2", "fix shubham 2", "gate"]);
  const tests = readAcceptanceTests(dir)!.tests;
  expect(tests.map((t) => [t.id, t.planItem, t.source])).toEqual([["AT-R-1", "SC2", "review"]]);
});

test("a finding without proof goes to the notes and to no builder", async () => {
  const { deps, calls } = standIns({ runStage5: async () => (calls.push("review"), { pass: false, findings: [noProof] }) });
  const r = await runReviewOnceWithDeps("p1", plan, s4, deps);
  expect(r.pass).toBe(true);
  expect(calls.some((c) => c.startsWith("fix"))).toBe(false);
  const notes = readFileSync(join(dir, "review-notes.jsonl"), "utf-8");
  expect(notes).toContain("needs a reproduction test");
});

test("a code finding the Chief AI rules not true is not sent to a builder", async () => {
  const { deps, calls } = standIns({
    runStage5: async () => (calls.push("review"), { pass: false, findings: [codeFinding] }),
    chiefChat: async () => JSON.stringify([{ id: 1, verdict: "false", quote: "JOIN menu_items mi ON mi.id = oi.menu_item_id", reason: "this file is the read side; the name is stored at insert" }]),
  });
  const r = await runReviewOnceWithDeps("p1", plan, s4, deps);
  expect(r.pass).toBe(true);
  expect(calls.some((c) => c.startsWith("fix"))).toBe(false);
});

test("a finding whose reproduction passes on the app is not reproduced, and goes to the notes", async () => {
  const pass = (n: number): RunSummary => ({ ...failed(n), results: failed(n).results.map((x) => ({ ...x, status: "passed" as const })), passed: n, failed: 0 });
  const { deps, calls } = standIns({ runStage5: async () => (calls.push("review"), { pass: false, findings: [reproduced] }), reproduce: async (t) => pass(t.length) });
  const r = await runReviewOnceWithDeps("p1", plan, s4, deps);
  expect(r.pass).toBe(true);
  expect(readAcceptanceTests(dir)!.tests).toEqual([]);
  expect(readFileSync(join(dir, "review-notes.jsonl"), "utf-8")).toContain("not reproduced");
});

test("tests that still fail after the gate's rounds hold the build, with what fails", async () => {
  const { deps } = standIns({ gate: async () => ({ status: "failing", reason: "2 fix rounds in a row made no more tests pass", failing: ["AT-R-1 [SC2]"] }) });
  const r = await runReviewOnceWithDeps("p1", plan, s4, deps);
  expect(r).toMatchObject({ pass: false, stuck: true });
  expect(r.hold?.reason).toContain("made no more tests pass");
  expect(r.hold?.evidence).toContain("AT-R-1 [SC2]");
});

test("a fix run that could not finish leaves its findings open, and the build is held", async () => {
  const { deps } = standIns({ fixShubham: async () => ({ success: false, filesWritten: [] }) });
  const r = await runReviewOnceWithDeps("p1", plan, s4, deps);
  expect(r).toMatchObject({ pass: false, stuck: true });
  expect(r.hold?.reason).toContain("not fixed");
});

test("a review that did not complete is run again, at most twice, then held — never passed", async () => {
  let n = 0;
  const notice = { file: "", issue: "[logic/HIGH] review-incomplete: the reviewer did not finish" };
  const { deps } = standIns({ runStage5: async () => (n++, { pass: false, findings: [notice] }) });
  const r = await runReviewOnceWithDeps("p1", plan, s4, deps);
  expect(n).toBe(3);
  expect(r).toMatchObject({ pass: false, stuck: true });
  expect(r.hold?.reason).toContain("did not complete");
});

test("a question for the customer stops the step before the gate", async () => {
  const { deps, calls } = standIns({ openQuestions: () => 1 });
  const r = await runReviewOnceWithDeps("p1", plan, s4, deps);
  expect(r).toMatchObject({ pass: false, stuck: false });
  expect(calls).not.toContain("gate");
  expect(existsSync(join(dir, "review-notes.jsonl"))).toBe(true);
});
