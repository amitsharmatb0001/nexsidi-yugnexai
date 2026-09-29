import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { projectFieldsAfterDeploy } from "./index.ts";

// 2026-09-29: real bug (project a034f90ba50e). The deploy step wrote
// projects.status = "done" the moment its own checks passed — but Stage 6's
// live review and fix loop only START after that, and ran for 50+ minutes
// while the dashboard already said "done". A worker crash in that window
// would have left a never-reviewed app labelled delivered. The deploy step
// now records only where the app is running; the workflow owns the status.
test("the deploy step records the app URL but never the project status", () => {
  const fields = projectFieldsAfterDeploy("http://localhost:3207");
  expect(fields.appUrl).toBe("http://localhost:3207");
  expect("status" in fields).toBe(false);
  expect("failureReason" in fields).toBe(false);
});

test("the workflow marks the project done only after Stage 6 (deploy + live review) succeeds", () => {
  const source = readFileSync(new URL("../../../pipeline/workflows/project-build.ts", import.meta.url), "utf-8");
  const fnStart = source.indexOf("async function runGate2AndStage6");
  const fnBody = source.slice(fnStart, source.indexOf("\n  }\n", fnStart));
  const successBreak = fnBody.indexOf("if (deployResult.success)");
  const markDone = fnBody.indexOf("act.markProjectDone(projectId, deliveredAppUrl)");
  expect(successBreak).toBeGreaterThan(-1);
  expect(markDone).toBeGreaterThan(successBreak);
  // Gated on its own patch marker so replaying a history recorded before this
  // change (e.g. a query on an already-finished workflow) stays deterministic.
  expect(fnBody).toContain('patched("mark-done-after-live-review-v1")');
});

test("markProjectDone clears a failure reason left by an earlier escalation", () => {
  const source = readFileSync(new URL("../../../pipeline/activities/index.ts", import.meta.url), "utf-8");
  const fnStart = source.indexOf("export async function markProjectDone");
  const fnBody = source.slice(fnStart, source.indexOf("\n}\n", fnStart));
  expect(fnBody).toContain('status: "done"');
  expect(fnBody).toContain("failureReason: null");
});
