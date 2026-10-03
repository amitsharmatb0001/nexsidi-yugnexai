import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordDispute, readDisputes, DISPUTE_FINDING_TOOL_DEF } from "./dispute.ts";

// 2026-10-03 (evidence-only plan, T5; Ledgerly run 4): the frontend builder
// was told the spec's colours were missing, saw them in its own theme, and
// "fixed" it anyway — it had no way to say the finding was wrong. A builder
// now confirms a finding first and, when the facts say it is wrong, disputes
// it with what it checked and what it saw. Tilotma settles it.
const prevBuildDir = process.env.BUILD_DIR;
let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  process.env.BUILD_DIR = prevBuildDir;
});

test("a dispute with what was checked and what was seen is recorded for Tilotma", () => {
  dir = mkdtempSync(join(tmpdir(), "dispute-"));
  process.env.BUILD_DIR = dir;
  const r = recordDispute("p1", "aanya", {
    finding: "frontend/app/layout.tsx: [spec-compliance] colour #059669 does not appear in the live theme",
    checked: "read app/layout.tsx; opened the live page and read --nx-color-primary",
    observed: "layout.tsx sets primary #059669; the live page has --nx-color-primary: #059669",
  });
  expect(r.status).toBe("success");
  const all = readDisputes("p1");
  expect(all.length).toBe(1);
  expect(all[0]!.agent).toBe("aanya");
  expect(all[0]!.observed).toContain("#059669");
});

test("a dispute without what was checked or what was seen is refused", () => {
  dir = mkdtempSync(join(tmpdir(), "dispute-"));
  process.env.BUILD_DIR = dir;
  expect(recordDispute("p1", "aanya", { finding: "x", checked: "", observed: "y" }).status).toBe("error");
  expect(recordDispute("p1", "aanya", { finding: "x", checked: "y", observed: "" }).status).toBe("error");
  expect(readDisputes("p1")).toEqual([]);
});

test("disputes can be read from a point in time, so each fix round sees only its own", () => {
  dir = mkdtempSync(join(tmpdir(), "dispute-"));
  process.env.BUILD_DIR = dir;
  recordDispute("p1", "shubham", { finding: "a", checked: "c", observed: "o" });
  const since = new Date(Date.now() + 5).toISOString();
  const until = Date.now() + 10;
  while (Date.now() < until) { /* wait past `since` */ }
  recordDispute("p1", "shubham", { finding: "b", checked: "c", observed: "o" });
  expect(readDisputes("p1", since).map((d) => d.finding)).toEqual(["b"]);
});

test("the tool asks for the finding, what was checked and what was seen", () => {
  expect(DISPUTE_FINDING_TOOL_DEF.function.parameters.required).toEqual(["finding", "checked", "observed"]);
});
