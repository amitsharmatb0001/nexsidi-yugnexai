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

// 2026-10-30 (understanding plan, step 3): a rule the code breaks is found by the system's check on the app map, whether or
// not a reviewer saw it, and goes to its owner's one fix run as a system finding (no proof needed: the map read it from the code).
test("a rule the code breaks goes to its owner's fix run even when no reviewer reported it", async () => {
  writeFileSync(join(dir, "backend", "src", "routes", "search.ts"), "export const search = async (req, res) => {\n  await db.query(`SELECT id FROM orders WHERE note = '${req.query.q}'`);\n};\n");
  const sent: string[] = [];
  const { deps, calls } = standIns({
    runStage5: async () => (calls.push("review"), { pass: true, findings: [] }),
    fixShubham: async (_p, f) => (sent.push(...f), calls.push(`fix shubham ${f.length}`), { success: true, filesWritten: [] }),
  });
  const r = await runReviewOnceWithDeps("p1", plan, s4, deps);
  expect(r.pass).toBe(true);
  expect(calls).toContain("fix shubham 1");
  expect(sent[0]).toContain("[map-rule SEC1] backend/src/routes/search.ts:2");
});

// 2026-10-30 (understanding plan, step 4): findings are identified by the rule they cite and the place in the app map their
// line falls in — the same fact in other words, or from the map's own check, reaches the builder once; and a fact that was
// sent to a builder before is marked as come back.
function historyBuild() {
  mkdirSync(join(dir, "db", "migrations"), { recursive: true });
  writeFileSync(join(dir, "db", "migrations", "0000.sql"), `CREATE TABLE "menu_items" ("id" uuid PRIMARY KEY, "name" text NOT NULL, "price" numeric NOT NULL);
CREATE TABLE "orders" ("id" uuid PRIMARY KEY);
CREATE TABLE "order_items" ("id" uuid PRIMARY KEY, "order_id" uuid REFERENCES "orders"("id"), "menu_item_id" uuid REFERENCES "menu_items"("id"), "quantity" integer, "name_at_time" text, "price_at_time" numeric);`);
}

test("a reviewer's finding and the map's broken rule about the same fact reach the builder once", async () => {
  historyBuild();
  const sent: string[] = [];
  const { deps } = standIns({
    runStage5: async () => ({ pass: false, findings: [codeFinding] }),
    fixShubham: async (_p, f) => (sent.push(...f), { success: true, filesWritten: [] }),
  });
  await runReviewOnceWithDeps("p1", plan, s4, deps);
  const int1 = sent.filter((s) => s.includes("INT1"));
  expect(int1).toHaveLength(1);
  expect(int1[0]).toContain("[map-rule INT1]");
});

test("a fact sent to a builder before is marked as come back, with when and to whom", async () => {
  historyBuild();
  const { recordSent } = await import("../app-map/identity.ts");
  recordSent(dir, [{ identity: "INT1|endpoint:GET /:id", owner: "shubham", text: "reads the current name" }], "2026-10-25T14:20:00Z");
  const sent: string[] = [];
  const { deps } = standIns({
    runStage5: async () => ({ pass: true, findings: [] }),
    fixShubham: async (_p, f) => (sent.push(...f), { success: true, filesWritten: [] }),
  });
  await runReviewOnceWithDeps("p1", plan, s4, deps);
  expect(sent.find((s) => s.includes("[map-rule INT1]"))).toContain("CAME BACK: sent to shubham at 2026-10-25T14:20:00Z");
});

// 2026-10-30 (team plan, stage 7): the map's broken rules are kept in mistake memory by their fact keys, not by a model's
// summary of their words; only the reviewers' own findings go the old way.
test("the map's broken rules are not sent to the model-summary memory; the reviewers' findings are", async () => {
  writeFileSync(join(dir, "backend", "src", "routes", "search.ts"), "export const search = async (req, res) => {\n  await db.query(`SELECT id FROM orders WHERE note = '${req.query.q}'`);\n};\n");
  const summarised: string[] = [];
  const { deps } = standIns({ recordInstincts: async (_o, texts) => void summarised.push(...texts) });
  await runReviewOnceWithDeps("p1", plan, s4, deps);
  expect(summarised.some((t) => t.includes("[map-rule"))).toBe(false);
  expect(summarised.some((t) => t.includes("[route-sweep]"))).toBe(true);
});
