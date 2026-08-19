import { test, expect } from "bun:test";
import { toPosixPath } from "./artifacts.ts";

// 2026-08-19: real bug found live — the artifact tree emitted paths straight
// off Node's join(), so on Windows every path used backslashes
// ("backend\src\controllers\admin.ts"). The web client splits on "/" to build
// its folder tree, so nothing nested: the explorer showed one flat row per
// file with the raw backslash path as its label. The same string is echoed
// back as ?path= on the file endpoint, so this wire format has to be
// platform-independent either way.

test("toPosixPath converts Windows separators to forward slashes", () => {
  expect(toPosixPath("backend\\src\\controllers\\admin.ts")).toBe("backend/src/controllers/admin.ts");
});

test("toPosixPath leaves an already-POSIX path unchanged", () => {
  expect(toPosixPath("backend/src/app.ts")).toBe("backend/src/app.ts");
});

test("toPosixPath normalises mixed separators, which Windows joins can produce", () => {
  expect(toPosixPath("frontend\\app/dashboard\\page.tsx")).toBe("frontend/app/dashboard/page.tsx");
});

test("toPosixPath collapses repeated separators rather than emitting empty segments", () => {
  // An empty segment would render as a nameless folder in the client's tree.
  expect(toPosixPath("db\\\\migrations\\0000_initial.sql")).toBe("db/migrations/0000_initial.sql");
});

test("toPosixPath handles a bare filename at the project root", () => {
  expect(toPosixPath("docker-compose.yml")).toBe("docker-compose.yml");
});

test("toPosixPath produces segments a client can split on '/' to nest correctly", () => {
  // The actual property the explorer depends on.
  expect(toPosixPath("backend\\src\\routes\\index.ts").split("/")).toEqual([
    "backend",
    "src",
    "routes",
    "index.ts",
  ]);
});

// The Changes view answers "what did this build produce". The pipeline's own
// logs and QA bookkeeping dominate that diff by line count (a single run's
// pipeline.log was +914 lines against ~60 lines of real source edits), so
// they are excluded from the file list.
import { isPipelineBookkeeping } from "./artifacts.ts";

test("isPipelineBookkeeping excludes the run's own log directory", () => {
  expect(isPipelineBookkeeping("logs/pipeline.log")).toBe(true);
  expect(isPipelineBookkeeping("logs/events.jsonl")).toBe(true);
});

test("isPipelineBookkeeping excludes per-agent history and QA submission files", () => {
  expect(isPipelineBookkeeping("history-riya.json")).toBe(true);
  expect(isPipelineBookkeeping("qa-submissions.json")).toBe(true);
});

test("isPipelineBookkeeping keeps real generated source and config", () => {
  expect(isPipelineBookkeeping("docker-compose.yml")).toBe(false);
  expect(isPipelineBookkeeping("frontend/Dockerfile")).toBe(false);
  expect(isPipelineBookkeeping("backend/src/app.ts")).toBe(false);
  expect(isPipelineBookkeeping("db/migrations/0000_initial.sql")).toBe(false);
});

test("isPipelineBookkeeping does not exclude an app file that merely mentions history", () => {
  // The pattern is anchored, so a real source file is never mistaken for one
  // of the pipeline's own records.
  expect(isPipelineBookkeeping("frontend/lib/history-store.ts")).toBe(false);
  expect(isPipelineBookkeeping("backend/src/logs.ts")).toBe(false);
});
