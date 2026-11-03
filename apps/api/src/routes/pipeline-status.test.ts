import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { statusWhenWorkflowEnds } from "./pipeline.ts";

// 2026-11-03 (Brewline 8): a change request that timed out left a FAILED workflow behind a delivered app, and reopening the build page
// wrote "failed" over the project's "done". A workflow that ended badly does not undo a delivery that already happened.
test("a failed workflow marks an undelivered project failed", () => {
  expect(statusWhenWorkflowEnds({ status: "building", appUrl: null })).toBe("failed");
  expect(statusWhenWorkflowEnds({ status: "planning", appUrl: null })).toBe("failed");
});

test("a failed workflow leaves a delivered project as it is", () => {
  expect(statusWhenWorkflowEnds({ status: "done", appUrl: "http://localhost:3202" })).toBeNull();
});

test("a project that is not done but has an app address, from an earlier delivery, is not marked failed either", () => {
  expect(statusWhenWorkflowEnds({ status: "building", appUrl: "http://localhost:3202" })).toBeNull();
});

test("the status stream uses it", () => {
  const src = readFileSync(new URL("./pipeline.ts", import.meta.url), "utf-8");
  expect(src).toContain("statusWhenWorkflowEnds(");
});
