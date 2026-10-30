import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

// 2026-10-30 (understanding plan, step 2): the app map is rebuilt from the code after every step that changes code and
// before every step that judges it, so what the system knows is the code as it is now. Checked in source.
const acts = readFileSync(new URL("../activities/index.ts", import.meta.url), "utf-8");
const gateReal = readFileSync(new URL("../orchestrator/acceptance-gate-real.ts", import.meta.url), "utf-8");
const body = (name: string) => acts.slice(acts.indexOf(name), acts.indexOf(name) + 3_500);

test("each builder's step, the database step and the blocker decisions rebuild the map when they end", () => {
  expect(body("async function runPhaseFor(")).toContain("refreshAppMap(buildDirFor(projectId))");
  expect(body("export async function runPranav(")).toContain("refreshAppMap(buildDirFor(projectId))");
  expect(body("export async function resolveBlockersActivity(")).toContain("refreshAppMap(buildDirFor(projectId))");
});

test("the acceptance gate, the review and the live step rebuild the map before they judge the code", () => {
  expect(body("export async function runAcceptanceGateActivity(")).toContain("refreshAppMap(buildDirFor(projectId))");
  expect(body("export async function runQAFixLoopActivity(")).toContain("refreshAppMap(buildDirFor(projectId))");
  expect(body("export async function runDeployWithLiveRetest(")).toContain("refreshAppMap(buildDirFor(projectId))");
  // every gate round starts from the code as the fixes left it
  expect(gateReal).toContain("refreshAppMap(dir)");
});
