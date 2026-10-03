import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSettleTask, settleDisputes } from "./settle-disputes.ts";
import { recordVerdict } from "../../../packages/agent-runtime/src/tools/settle.ts";

// 2026-10-03 (evidence-only plan, T6): Tilotma settles disputed findings by
// checking them herself — the builder's account is a claim too.
const D = [
  { agent: "aanya", finding: "frontend/app/layout.tsx: colour #059669 missing", checked: "read layout.tsx", observed: "primary #059669", at: "2026-10-03T00:00:00.000Z" },
  { agent: "shubham", finding: "backend/src/a.ts: 500 on POST /x", checked: "curl", observed: "201", at: "2026-10-03T00:00:00.000Z" },
];
const prev = process.env.BUILD_DIR;
let dir = "";
afterEach(() => {
  process.env.BUILD_DIR = prev;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("the task lists every dispute by number and asks her to check each one herself", () => {
  const t = buildSettleTask(D, { appUrl: "http://localhost:3200", backendUrl: "http://localhost:3300" });
  expect(t).toContain("1.");
  expect(t).toContain("2.");
  expect(t).toContain("colour #059669 missing");
  expect(t).toContain("http://localhost:3200");
  expect(t).toMatch(/check (it|each one) yourself/i);
  expect(t).toContain("settle_dispute");
});

test("each verdict she records is matched to its dispute; unsettled ones are left out", async () => {
  dir = mkdtempSync(join(tmpdir(), "settle-run-"));
  process.env.BUILD_DIR = dir;
  let config: Record<string, unknown> = {};
  const verdicts = await settleDisputes("p1", D, { reviewRoot: dir }, {
    run: async (cfg) => {
      config = cfg as never;
      recordVerdict("p1", { number: 1, verdict: "not_true", evidence: "live --nx-color-primary: #059669" });
      return { success: true } as never;
    },
  });
  expect(verdicts).toEqual([{ dispute: D[0]!, verdict: "not_true" as const, evidence: "live --nx-color-primary: #059669" }]);
  expect(config.readOnly).toBe(true);
  expect(config.enableDisputeSettling).toBe(true);
  expect(config.extendStepsWhileProgressing).toBe(true);
});
