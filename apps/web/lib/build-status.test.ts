import { test, expect } from "bun:test";
import { statusForStageEvent } from "./build-status.ts";

// 2026-09-28: real bug seen live (project a61968de2ecf). The build halted
// (needs_review / budget_exceeded) and the page loaded that status, but the
// status stream then sent {stage:"error"} and the page set status "building"
// for ANY stage — hiding the "needs your attention" card and its Retry button
// behind a bare "Execution failed. View system logs for details."
test("a terminal error stage does not flip the page back to building; it asks for the real result instead", () => {
  expect(statusForStageEvent("error")).toEqual({ status: null, refetchResult: true });
});

test("a normal pipeline stage still marks the build as in progress", () => {
  expect(statusForStageEvent("generate")).toEqual({ status: "building", refetchResult: false });
  expect(statusForStageEvent("await_spec_approval")).toEqual({ status: "building", refetchResult: false });
});

test("done/deliver keep building status but refresh the result (existing behaviour)", () => {
  expect(statusForStageEvent("done")).toEqual({ status: "building", refetchResult: true });
  expect(statusForStageEvent("deliver")).toEqual({ status: "building", refetchResult: true });
});
