import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAcceptanceGate, acceptanceFixCheck, acceptanceFinding, ownerOfTest, type GateDeps } from "./acceptance-gate.ts";
import { saveAcceptanceTests, readAcceptanceTests, type AcceptanceTest } from "./acceptance-tests.ts";
import type { RunSummary, TestResult } from "./acceptance-runner.ts";
import { testFixOutcome } from "../../packages/agent-runtime/src/enforce/fix-accounting.ts";

// 2026-10-30 (team plan, stage 4): the build is done when its acceptance tests pass on the running app, not when the
// builders say so. The system starts the app, runs the tests and sends each failing test to its owner; a fix is done
// when the test passes (or the Chief AI has ruled on a dispute); rounds stop when they stop making progress and the build
// is held for a person. Stand-in steps here: no app, no model.

let dir = "";
const api: AcceptanceTest = { id: "AT-1-1", phase: 1, planItem: "INT1", title: "an order keeps the item's name", as: "user", kind: "api", steps: [{ method: "GET", path: "/api/v1/orders/1", expectStatus: 200 }] };
const page: AcceptanceTest = { id: "AT-1-2", phase: 1, planItem: "SC2", title: "a visitor signs up", as: "anyone", kind: "journey", steps: [{ do: "open", path: "/sign-up" }, { do: "see", text: "Welcome" }] };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gate-"));
  process.env.BUILD_DIR = dir;
  mkdirSync(join(dir, "p1"), { recursive: true });
  saveAcceptanceTests(join(dir, "p1"), { writtenAt: "t", tests: [api, page], rejected: [], notWritten: [] });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.BUILD_DIR;
});

const result = (t: AcceptanceTest, status: TestResult["status"], detail = ""): TestResult => ({ id: t.id, phase: t.phase, planItem: t.planItem, title: t.title, status, detail, ...(status === "failed" ? { step: 1 } : {}) });
const summary = (results: TestResult[]): RunSummary => ({ at: "t", results, passed: results.filter((r) => r.status === "passed").length, failed: results.filter((r) => r.status === "failed").length, notChecked: results.filter((r) => r.status === "not_checked").length });

/** Stand-in steps: `app` says which tests pass now; the fixers change it (or not). */
function standIns(app: Record<string, boolean>, fixer: (owner: string, findings: string[]) => { filesWritten: number; escalations?: Array<{ targetAgent: "shubham" | "aanya" | "pranav"; finding: string; reason: string }> } = () => ({ filesWritten: 1 })) {
  const calls: string[] = [];
  const deps: GateDeps = {
    deploy: async () => (calls.push("deploy"), { appUrl: "http://app", backendUrl: "http://api" }),
    run: async (tests) => (calls.push(`run ${tests.map((t) => t.id).join(",")}`), summary(tests.map((t) => result(t, app[t.id] ? "passed" : "failed", "expected 200, got 500")))),
    fix: async (owner, findings) => {
      calls.push(`fix ${owner} ${findings.map((f) => f.match(/AT-\d+-\d+/)?.[0]).join(",")}`);
      const r = fixer(owner, findings);
      return { filesWritten: r.filesWritten, escalations: r.escalations ?? [] };
    },
    settle: async () => (calls.push("settle"), { withdrawn: [] }),
  };
  return { deps, calls };
}

test("a build whose tests all pass closes at once, with no fix", async () => {
  const { deps, calls } = standIns({ "AT-1-1": true, "AT-1-2": true });
  const r = await runAcceptanceGate(join(dir, "p1"), deps);
  expect(r.status).toBe("passed");
  expect(calls).toEqual(["deploy", "run AT-1-1,AT-1-2"]);
});

test("the build stays open while a test fails: a fix that writes files but leaves the test failing does not close it", async () => {
  const { deps, calls } = standIns({ "AT-1-1": false, "AT-1-2": true });
  const r = await runAcceptanceGate(join(dir, "p1"), deps, { maxFixRounds: 4, stuckRounds: 2 });
  expect(r.status).toBe("failing");
  expect(r.last?.results.find((x) => x.id === "AT-1-1")?.status).toBe("failed");
  // Two fix rounds in a row made no more tests pass, so it stopped; the workflow holds the build for a person.
  expect(calls.filter((c) => c.startsWith("fix")).length).toBe(2);
  expect(r.reason).toContain("AT-1-1");
});

test("a fix that makes the test pass closes the build on the next run", async () => {
  const app = { "AT-1-1": false, "AT-1-2": true };
  const { deps, calls } = standIns(app, () => ((app["AT-1-1"] = true), { filesWritten: 1 }));
  const r = await runAcceptanceGate(join(dir, "p1"), deps);
  expect(r.status).toBe("passed");
  expect(calls).toEqual(["deploy", "run AT-1-1,AT-1-2", "fix shubham AT-1-1", "settle", "deploy", "run AT-1-1,AT-1-2"]);
});

test("an API test goes to the backend builder, a journey to the frontend builder; a hand-off is fixed in the same round", async () => {
  expect(ownerOfTest(api)).toBe("shubham");
  expect(ownerOfTest(page)).toBe("aanya");
  const app = { "AT-1-1": true, "AT-1-2": false };
  const { deps, calls } = standIns(app, (owner, findings) => {
    if (owner === "aanya") return { filesWritten: 0, escalations: [{ targetAgent: "shubham", finding: findings[0]!, reason: "sign-up answers 500" }] };
    app["AT-1-2"] = true;
    return { filesWritten: 1 };
  });
  const r = await runAcceptanceGate(join(dir, "p1"), deps);
  expect(r.status).toBe("passed");
  expect(calls.slice(0, 4)).toEqual(["deploy", "run AT-1-1,AT-1-2", "fix aanya AT-1-2", "fix shubham AT-1-2"]);
});

test("a disputed test is decided by the Chief AI: a test ruled wrong is withdrawn and no longer counts", async () => {
  const { deps, calls } = standIns({ "AT-1-1": false, "AT-1-2": true }, () => ({ filesWritten: 0 }));
  deps.settle = async () => (calls.push("settle"), { withdrawn: [{ id: "AT-1-1", evidence: "the contract has no GET /api/v1/orders/1 shape with a name" }] });
  const r = await runAcceptanceGate(join(dir, "p1"), deps);
  expect(r.status).toBe("passed");
  expect(r.withdrawn).toEqual(["AT-1-1"]);
  expect(calls.at(-1)).toBe("run AT-1-2");
  expect(readAcceptanceTests(join(dir, "p1"))?.withdrawn).toEqual([{ id: "AT-1-1", evidence: "the contract has no GET /api/v1/orders/1 shape with a name", at: expect.any(String) }]);
});

test("an app that cannot be started is not checked, and nothing is sent to a builder", async () => {
  const { deps, calls } = standIns({});
  deps.deploy = async () => (calls.push("deploy"), { reason: "docker compose up --build failed: backend build error" });
  const r = await runAcceptanceGate(join(dir, "p1"), deps);
  expect(r).toMatchObject({ status: "not_checked", reason: expect.stringContaining("backend build error") });
  expect(calls).toEqual(["deploy"]);
});

test("a build without acceptance tests is not checked", async () => {
  const { deps } = standIns({});
  const r = await runAcceptanceGate(join(dir, "nothing-here"), deps);
  expect(r).toMatchObject({ status: "not_checked", reason: expect.stringContaining("no acceptance tests") });
});

test("a question for the customer stops the round; a budget stop is not swallowed", async () => {
  const { deps } = standIns({ "AT-1-1": false, "AT-1-2": true });
  deps.openQuestions = () => true;
  expect((await runAcceptanceGate(join(dir, "p1"), deps)).status).toBe("waiting_for_customer");
  const { deps: d2 } = standIns({ "AT-1-1": false });
  d2.beforeRound = async () => { throw new Error("budget_exceeded"); };
  await expect(runAcceptanceGate(join(dir, "p1"), d2)).rejects.toThrow("budget_exceeded");
});

test("the builder sees the failing test whole, with what a fix must achieve", () => {
  const text = acceptanceFinding(api, result(api, "failed", "step 1 (GET /api/v1/orders/1): expected 200, got 500"));
  expect(text).toContain("[acceptance AT-1-1 / INT1] an order keeps the item's name");
  expect(text).toContain("expected 200, got 500");
  expect(text).toContain("GET /api/v1/orders/1 → 200");
  expect(text).toContain("A fix is done only when this test passes on the running app");
  expect(text).toContain("dispute_finding");
  expect(text).toContain("escalate_finding");
});

// ── The fix run's own finish check: done means the test passes ─────────────

const recheck = (passes: boolean, redeploy: { ok: true } | { ok: false; reason: string } = { ok: true }) => ({
  redeploy: async () => redeploy,
  run: async (tests: AcceptanceTest[]) => summary(tests.map((t) => result(t, passes ? "passed" : "failed", "expected 200, got 500"))),
});

test("a fix run that changed files but left its test failing may not finish", async () => {
  const blocks = await acceptanceFixCheck("p1", [api], recheck(false), "2026-10-30T00:00:00Z");
  expect(blocks).toHaveLength(1);
  expect(blocks[0]).toContain("AT-1-1 [INT1] still fails on the running app");
  expect(blocks[0]).toContain("expected 200, got 500");
});

test("a fix run may finish when its test passes, or when it disputed or handed on the test", async () => {
  expect(await acceptanceFixCheck("p1", [api], recheck(true), "2026-10-30T00:00:00Z")).toEqual([]);
  appendFileSync(join(dir, "p1", "disputes.jsonl"), JSON.stringify({ agent: "shubham", finding: "[acceptance AT-1-1 / INT1] …", checked: "c", observed: "o", at: "2026-10-30T01:00:00Z" }) + "\n");
  expect(await acceptanceFixCheck("p1", [api], recheck(false), "2026-10-30T00:00:00Z")).toEqual([]);
  writeFileSync(join(dir, "p1", "disputes.jsonl"), "");
  appendFileSync(join(dir, "p1", "escalations.jsonl"), JSON.stringify({ agent: "aanya", targetAgent: "shubham", finding: "[acceptance AT-1-1 / INT1] …", reason: "r", at: "2026-10-30T01:00:00Z" }) + "\n");
  expect(await acceptanceFixCheck("p1", [api], recheck(false), "2026-10-30T00:00:00Z")).toEqual([]);
});

test("a dispute or hand-off from an earlier round does not excuse this round's failure", async () => {
  appendFileSync(join(dir, "p1", "disputes.jsonl"), JSON.stringify({ agent: "shubham", finding: "[acceptance AT-1-1 / INT1] …", checked: "c", observed: "o", at: "2026-10-29T01:00:00Z" }) + "\n");
  expect(await acceptanceFixCheck("p1", [api], recheck(false), "2026-10-30T00:00:00Z")).toHaveLength(1);
});

test("a change that breaks the app's build blocks finishing, with the reason", async () => {
  const blocks = await acceptanceFixCheck("p1", [api], recheck(true, { ok: false, reason: "docker compose up --build failed: TS2304" }), "2026-10-30T00:00:00Z");
  expect(blocks).toEqual([expect.stringContaining("did not rebuild and start after your change: docker compose up --build failed: TS2304")]);
});

test("fix accounting counts tests, not files: fixed, still failing, and newly broken", () => {
  const before = [result(api, "failed"), result(page, "passed")];
  const after = [result(api, "passed"), result(page, "failed")];
  expect(testFixOutcome(before, after)).toEqual({ fixed: ["AT-1-1"], stillFailing: [], broken: ["AT-1-2"] });
  expect(testFixOutcome(before, before)).toEqual({ fixed: [], stillFailing: ["AT-1-1"], broken: [] });
});

// 2026-10-30 (stage 4 proof against the stub app): a ruling that names a test already withdrawn counted as progress every
// round, so the gate never saw it was stuck and listed the same test four times.
test("a test withdrawn once is not withdrawn again, and does not count as progress", async () => {
  const { deps, calls } = standIns({ "AT-1-1": false, "AT-1-2": false }, () => ({ filesWritten: 1 }));
  deps.settle = async () => (calls.push("settle"), { withdrawn: [{ id: "AT-1-2", evidence: "outside the plan" }] });
  const r = await runAcceptanceGate(join(dir, "p1"), deps, { maxFixRounds: 6, stuckRounds: 2 });
  expect(r.status).toBe("failing");
  expect(r.withdrawn).toEqual(["AT-1-2"]);
  // round 1: both owners; rounds 2 and 3: the backend; then two rounds in a row without progress end it.
  expect(calls.filter((c) => c.startsWith("fix")).length).toBe(4);
  expect(readAcceptanceTests(join(dir, "p1"))?.withdrawn?.length).toBe(1);
});
