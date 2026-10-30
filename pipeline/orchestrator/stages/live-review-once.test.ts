import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitRepro, liveReviewState, markLiveReview, acceptanceFailureFindings, proveLiveFindings, reproInstruction } from "./live-review-once.ts";
import { saveAcceptanceTests, readAcceptanceTests, type AcceptanceTest } from "../acceptance-tests.ts";
import { agentForFile } from "./stage4-multi-agent-dev.ts";
import { isMachineFinding } from "../chief-check.ts";

// 2026-10-30 (team plan, stage 5): the live browser review and the design review run once. Their findings need proof like
// every review finding: a browser finding carries its reproduction on its line ("REPRO: {…}") and the runner must see it
// fail. After that one review, the live rounds run the system's checks and the acceptance tests only; a failing test is a
// finding for its owner.

let root = "";
let dir = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "live-"));
  process.env.BUILD_DIR = root;
  dir = join(root, "p1");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "spec.json"), JSON.stringify({ successCriteria: ["Customers sign up on /sign-up.", "Customers see their orders on /my-orders."] }));
  writeFileSync(join(dir, "api-contract.json"), JSON.stringify({ endpoints: [{ method: "GET", path: "/api/v1/orders", description: "Orders." }] }));
  writeFileSync(join(dir, "build-plan.json"), JSON.stringify({ buildPhases: [{ name: "All", goal: "all", pages: ["/sign-up", "/my-orders"], endpoints: ["GET /api/v1/orders"], tables: [] }] }));
  saveAcceptanceTests(dir, { writtenAt: "t", tests: [], rejected: [], notWritten: [] });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.BUILD_DIR;
});

const repro = { title: "My orders shows the customer's orders", as: "user", kind: "journey", steps: [{ do: "open", path: "/my-orders" }, { do: "see", text: "Your orders" }] };

test("a browser finding's reproduction is read from the end of its line", () => {
  const line = `[SC2] /my-orders shows a blank page for a signed-in customer REPRO: ${JSON.stringify(repro)}`;
  expect(splitRepro(line)).toEqual({ issue: "[SC2] /my-orders shows a blank page for a signed-in customer", reproduction: repro });
  expect(splitRepro("[SC2] no repro here")).toEqual({ issue: "[SC2] no repro here" });
  expect(splitRepro("[SC2] broken REPRO: {not json")).toEqual({ issue: "[SC2] broken REPRO: {not json" });
});

test("the browser review and the design review are each marked once they ran", () => {
  expect(liveReviewState(dir)).toEqual({});
  markLiveReview(dir, "browser");
  expect(Object.keys(liveReviewState(dir))).toEqual(["browser"]);
  markLiveReview(dir, "design");
  expect(Object.keys(liveReviewState(dir)).sort()).toEqual(["browser", "design"]);
});

test("a failing acceptance test is a finding for its owner, proven by the runner", () => {
  const api: AcceptanceTest = { id: "AT-1-1", phase: 1, planItem: "EP1", title: "orders list", as: "user", kind: "api", steps: [{ method: "GET", path: "/api/v1/orders", expectStatus: 200 }] };
  const page: AcceptanceTest = { id: "AT-1-2", phase: 1, planItem: "SC2", title: "my orders page", as: "user", kind: "journey", steps: [{ do: "open", path: "/my-orders" }] };
  const findings = acceptanceFailureFindings(
    { at: "t", passed: 0, failed: 2, notChecked: 0, results: [
      { id: "AT-1-1", phase: 1, planItem: "EP1", title: "orders list", status: "failed", step: 1, detail: "expected 200, got 500" },
      { id: "AT-1-2", phase: 1, planItem: "SC2", title: "my orders page", status: "failed", step: 1, detail: "opening /my-orders answered 404" },
    ] },
    [api, page],
  );
  expect(findings.map((f) => agentForFile(f.file))).toEqual(["shubham", "aanya"]);
  expect(findings[0]!.issue).toContain("[acceptance] AT-1-1 [EP1] orders list");
  expect(findings[0]!.issue).toContain("expected 200, got 500");
  expect(findings.every((f) => isMachineFinding(f.issue))).toBe(true);
});

test("browser findings: a reproduced one becomes a test and a finding; one without proof goes to the notes", async () => {
  const lines = [
    `[SC2] /my-orders shows a blank page REPRO: ${JSON.stringify(repro)}`,
    "[SC1] the sign-up page feels slow",
    "the footer looks plain",
  ];
  const r = await proveLiveFindings("p1", lines, async (tests) => ({
    at: "t", passed: 0, failed: tests.length, notChecked: 0,
    results: tests.map((t) => ({ id: t.id, phase: t.phase, planItem: t.planItem, title: t.title, status: "failed" as const, step: 2, detail: 'did not see "Your orders" on /my-orders' })),
  }));
  expect(r.findings).toHaveLength(1);
  expect(r.findings[0]!.file).toMatch(/^frontend\//);
  expect(r.findings[0]!.issue).toContain("[acceptance] AT-R-1 [SC2]");
  expect(readAcceptanceTests(dir)!.tests.map((t) => t.id)).toEqual(["AT-R-1"]);
  expect(r.notes).toBe(2);
  expect(readFileSync(join(dir, "review-notes.jsonl"), "utf-8").split("\n").filter(Boolean)).toHaveLength(2);
});

test("the browser reviewer is told how to give proof", () => {
  const text = reproInstruction();
  expect(text).toContain("REPRO:");
  expect(text).toContain('"kind"');
});
