import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

// 2026-10-29 (team plan, stage 2): a live fix round that leaves a question for the customer stops the live stage — no
// redeploy and no new review until the answer is in. The activity then pauses the build for the customer.
const src = readFileSync(new URL("./stage6-deployment.ts", import.meta.url), "utf-8");

test("a fix round with a question open reports it before anything else", () => {
  const fixes = src.slice(src.indexOf("const runOwnerFixes = async"), src.indexOf("let deployResult!: DeployResult;"));
  const wait = fixes.indexOf('return "waiting_for_customer"');
  expect(wait).toBeGreaterThan(-1);
  expect(fixes.indexOf("openCustomerQuestions(projectId).length > 0")).toBeLessThan(wait);
  expect(wait).toBeLessThan(fixes.indexOf('return "nothing_changed"'));
});

test("both places that run a fix round stop on it", () => {
  expect((src.match(/if \(outcome === "waiting_for_customer"\) break;/g) ?? []).length).toBe(2);
});
