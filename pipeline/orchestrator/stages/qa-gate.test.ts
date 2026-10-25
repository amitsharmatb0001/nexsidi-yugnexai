import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gateQaFindings } from "./stage5-qa-fix-loop.ts";

// 2026-10-24 (Brewline root cause): the code review raised an "admin is locked out" finding (no admin role exists in the
// spec) and performance nits for one coffee shop, and each started a fix round. The Chief AI's one call now decides
// which reviewer findings break the approved plan; the rest are kept for later and do not hold the build.

const prevBuildDir = process.env.BUILD_DIR;
let root = "";
afterEach(() => {
  if (prevBuildDir === undefined) delete process.env.BUILD_DIR;
  else process.env.BUILD_DIR = prevBuildDir;
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function project(id: string): string {
  root = mkdtempSync(join(tmpdir(), "qa-gate-"));
  process.env.BUILD_DIR = root;
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "spec.json"), JSON.stringify({ successCriteria: ["Staff can update order status"] }));
  writeFileSync(join(dir, "api-contract.json"), JSON.stringify({ endpoints: [{ method: "PATCH", path: "/api/v1/orders/:id/status", description: "(staff only)" }] }));
  return dir;
}

const findings = [
  { file: "frontend/app/menu/page.tsx", issue: "[emoji-ui] emoji are used as ui graphics on lines 122" },
  { file: "frontend/app/staff/dashboard/page.tsx", issue: "frontend/app/staff/dashboard/page.tsx:60 — [logic/HIGH] locks out administrators (role 'admin')" },
  { file: "backend/src/controllers/orders.controller.ts", issue: "backend/src/controllers/orders.controller.ts:231 — [performance/CRITICAL] getAllOrders has no pagination" },
  { file: "backend/src/controllers/orders.controller.ts", issue: "backend/src/controllers/orders.controller.ts:190 — [logic/HIGH] status update writes the wrong column" },
];

test("only findings that break a plan item are fixed; out-of-plan ones are kept for later", async () => {
  const dir = project("q1");
  const out = await gateQaFindings("q1", { pass: false, findings, score: 40 } as never, async () => JSON.stringify([
    { id: 1, verdict: "later", reason: "the spec has no admin role" },
    { id: 2, verdict: "later", reason: "one coffee shop; no plan item asks for pagination" },
    { id: 3, verdict: "fix", plan_item: "SC1", text: "status update writes the wrong column" },
  ]));
  expect(out.findings.map((f) => f.issue)).toEqual([
    "[emoji-ui] emoji are used as ui graphics on lines 122",
    "[SC1] backend/src/controllers/orders.controller.ts:190 — [logic/HIGH] status update writes the wrong column",
  ]);
  expect(out.pass).toBe(false);
  expect(readFileSync(join(dir, "later.jsonl"), "utf-8").split("\n").filter(Boolean).length).toBe(2);
});

test("when nothing left breaks the plan, the round passes", async () => {
  const dir2 = project("q2");
  mkdirSync(join(dir2, "backend", "src", "controllers"), { recursive: true });
  writeFileSync(join(dir2, "backend", "src", "controllers", "orders.controller.ts"), "const page = Number(req.query.page) || 1; // the list is paginated\n");
  const out = await gateQaFindings("q2", { pass: false, findings: findings.slice(1, 3), score: 70 } as never, async () => JSON.stringify([
    { id: 1, verdict: "later", reason: "no admin role" },
    { id: 2, verdict: "false", quote: "const page = Number(req.query.page) || 1;", reason: "the list is paginated" },
  ]));
  expect(out.findings).toEqual([]);
  expect(out.pass).toBe(true);
});

test("without the check (tests, or no model) findings pass unchanged", async () => {
  project("q3");
  const input = { pass: false, findings, score: 40 } as never;
  expect(await gateQaFindings("q3", input, null)).toBe(input);
});
