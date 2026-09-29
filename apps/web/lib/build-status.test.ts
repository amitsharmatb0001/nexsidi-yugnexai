import { test, expect } from "bun:test";
import { statusForStageEvent, statusFromResult } from "./build-status.ts";

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

// 2026-09-28: real bug seen live (project a61968de2ecf). The launch step put
// the app up (appUrl set) but its post-launch check failed, so the project is
// needs_review, waiting for a Retry decision. The page treated ANY appUrl as
// "done", showing "Open app" and hiding the "needs your attention" card and
// its Retry button — the build could not be resumed from the UI.
test("a project waiting for a retry decision stays needs_review even though its app URL exists", () => {
  expect(statusFromResult({ status: "needs_review", appUrl: "http://localhost:3200" })).toBe("needs_review");
});

test("an app URL still means done for every other status (existing behaviour)", () => {
  expect(statusFromResult({ status: "done", appUrl: "http://localhost:3200" })).toBe("done");
  expect(statusFromResult({ status: "failed", appUrl: "http://localhost:3200" })).toBe("done");
  expect(statusFromResult({ status: "building", appUrl: null })).toBe("building");
});

// 2026-09-28: real bug seen live (project a034f90ba50e, Plantly). Generation
// failed and the project was needs_review, but the status stream kept
// reporting the stage the workflow is parked at ("generate"), and every stage
// event forced "building" — the page showed "Writing your code… 2-4 minutes"
// for 30 minutes with no Retry button. While a project needs review, a stage
// event re-checks the result instead (a retry from anywhere flips it back).
test("a stage event never overrides needs_review — it re-checks the result instead", () => {
  expect(statusForStageEvent("generate", "needs_review")).toEqual({ status: null, refetchResult: true });
  expect(statusForStageEvent("deploy", "needs_review")).toEqual({ status: null, refetchResult: true });
  expect(statusForStageEvent("generate", "building")).toEqual({ status: "building", refetchResult: false });
});

// 2026-09-29: real bug (project a034f90ba50e, Plantly). The app URL is saved as
// soon as the app is launched, but the live review and its fix loop run after
// that — and a Retry keeps the previous run's URL. "building" with a URL is
// still building; only the workflow's own "done" finishes the build.
test("an app URL does not finish a build that is still running", () => {
  expect(statusFromResult({ status: "building", appUrl: "http://localhost:3207" })).toBe("building");
});
