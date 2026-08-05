import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listLabeledFiles, resolveLabeledFile, readLabeledFiles, detectStuckLoop, buildQaInitialMessage, computeQaMaxIterations, type LabeledDir } from "./qa-loop.ts";

let root: string;
let dirs: LabeledDir[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nexsidi-qa-loop-test-"));
  const backend = join(root, "backend");
  const frontend = join(root, "frontend");
  mkdirSync(join(backend, "src", "controllers"), { recursive: true });
  mkdirSync(join(backend, "node_modules", "somepkg"), { recursive: true });
  mkdirSync(join(frontend, "app"), { recursive: true });

  writeFileSync(join(backend, "src", "controllers", "tasks.ts"), "export const x = 1;");
  writeFileSync(join(backend, "src", "index.ts"), "export {};");
  writeFileSync(join(backend, "node_modules", "somepkg", "index.js"), "module.exports = {};");
  writeFileSync(join(backend, "package-lock.json"), "{}"); // .json IS a code extension — should be listed
  writeFileSync(join(backend, "logo.png"), "binary"); // not a code extension — should be skipped
  writeFileSync(join(frontend, "app", "page.tsx"), "export default function Page() {}");

  dirs = [
    { label: "backend", path: backend },
    { label: "frontend", path: frontend },
  ];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// 2026-07-26 (agent-autonomy-assessment F5): QA agents (Navya/Karan/
// Deepika) previously reviewed code with NO spec, NO API contract, NO DB
// schema — only the code itself and a "review for X" instruction. Live
// proof of the cost: with no scale/deployment context, QA re-flagged the
// same missing-DB-index "finding" as HIGH on every single round of a real
// 6-round run, and the debate step had to re-discover and re-discard it as
// a false positive every time — a whole QA agent's budget spent rediscovering
// the same non-bug. Worse, QA structurally cannot report "this doesn't match
// what the user asked for" without ever seeing what was asked for.
// buildQaInitialMessage is the pure, testable core of the message
// injecting system context — mirrors buildFixTask's split in
// Shubham/Aanya.
test("buildQaInitialMessage includes the system context ahead of the review instruction", () => {
  const msg = buildQaInitialMessage("logic errors", "SYSTEM YOU ARE WORKING ON:\nGreenway Estates Portal");
  expect(msg).toContain("Greenway Estates Portal");
  expect(msg).toContain("logic errors");
  expect(msg.indexOf("Greenway Estates Portal")).toBeLessThan(msg.indexOf("Review this codebase"));
});

test("buildQaInitialMessage works with no system context (backward compatible)", () => {
  const msg = buildQaInitialMessage("logic errors", undefined);
  expect(msg).toContain("Review this codebase for logic errors");
});

// 2026-08-03: real cost problem found live — a single QA round hit ~7.8M
// tokens because read_file is one-file-per-call and every call resends the
// full growing history. buildQaInitialMessage now steers agents toward
// read_files (batched) instead of read_file one at a time.
test("buildQaInitialMessage tells the agent to batch reads via read_files", () => {
  const msg = buildQaInitialMessage("logic errors", undefined);
  expect(msg).toContain("read_files");
  expect(msg).toContain("batch");
});

// ── readLabeledFiles (batch read) ───────────────────────────────────────────
test("readLabeledFiles reads multiple files in one call and reports which were actually read", () => {
  const { output, readPaths } = readLabeledFiles(dirs, ["backend/src/index.ts", "frontend/app/page.tsx"]);
  expect(readPaths).toEqual(["backend/src/index.ts", "frontend/app/page.tsx"]);
  expect(output).toContain("// FILE: backend/src/index.ts");
  expect(output).toContain("export {};");
  expect(output).toContain("// FILE: frontend/app/page.tsx");
  expect(output).toContain("export default function Page() {}");
});

test("readLabeledFiles reports a missing file inline instead of failing the whole batch", () => {
  const { output, readPaths } = readLabeledFiles(dirs, ["backend/src/index.ts", "backend/does-not-exist.ts"]);
  expect(readPaths).toEqual(["backend/src/index.ts"]); // only the real file counts toward coverage
  expect(output).toContain("// FILE: backend/does-not-exist.ts");
  expect(output).toContain("not found");
});

test("readLabeledFiles returns an empty result for an empty path list", () => {
  const { output, readPaths } = readLabeledFiles(dirs, []);
  expect(readPaths).toEqual([]);
  expect(output).toBe("");
});

// 2026-07-26 (agent-autonomy-assessment root-cause, follow-on): full
// coverage (finding-evidence.ts's checkReviewCoverage) now requires
// reading EVERY listed file — a fixed 30-iteration cap made that
// structurally impossible on a real-size project (complex1 had 84
// reviewable files; one read_file per iteration alone exceeds 30 before
// list_files or submit_findings ever run). The cap must scale with what
// full coverage actually costs: one iteration per file read, plus
// list_files, submit_findings, and slack for a few non-read turns.
test("computeQaMaxIterations scales past the old fixed cap for a real-size project", () => {
  expect(computeQaMaxIterations(84)).toBeGreaterThan(84);
});

test("computeQaMaxIterations never drops below the original 30 for small projects", () => {
  expect(computeQaMaxIterations(5)).toBeGreaterThanOrEqual(30);
  expect(computeQaMaxIterations(0)).toBeGreaterThanOrEqual(30);
});

test("listLabeledFiles prefixes every file with its label", () => {
  const files = listLabeledFiles(dirs);
  expect(files).toContain("backend/src/controllers/tasks.ts");
  expect(files).toContain("backend/src/index.ts");
  expect(files).toContain("frontend/app/page.tsx");
});

test("listLabeledFiles skips node_modules", () => {
  const files = listLabeledFiles(dirs);
  expect(files.some((f) => f.includes("node_modules"))).toBe(false);
});

test("listLabeledFiles skips non-code extensions", () => {
  const files = listLabeledFiles(dirs);
  expect(files.some((f) => f.endsWith("logo.png"))).toBe(false);
});

test("listLabeledFiles includes recognized code extensions like .json", () => {
  const files = listLabeledFiles(dirs);
  expect(files).toContain("backend/package-lock.json");
});

// 2026-07-28 (live, complex1): real bug found live — a generated frontend's
// vendored NexUI library (frontend/vendor/nexui + nexui-react, per CLAUDE.md
// "vendored into the generated app's own output dir — no external npm
// dependency") is STATIC, identical across every project and every QA round,
// and not code Navya/Karan/Deepika can find a fixable bug in (Shubham/Aanya
// don't own it either). Counted live on complex1: 200 vendor files vs only
// 30 real generated frontend files — RC-2's full-coverage requirement
// (checkReviewCoverage) forced all 3 QA agents to re-read all 200 vendor
// files on EVERY retest round, the dominant cost behind a 35+ minute
// live-retest wall-clock. Excluding it doesn't weaken full coverage of the
// actual generated app code RC-2 was protecting — vendor/ never changes and
// was never the thing a QA round could have found a real regression in.
test("listLabeledFiles skips a vendored (vendor/) directory", () => {
  mkdirSync(join(root, "frontend", "vendor", "nexui", "src"), { recursive: true });
  writeFileSync(join(root, "frontend", "vendor", "nexui", "src", "button.ts"), "export {};");

  const files = listLabeledFiles(dirs);

  expect(files.some((f) => f.includes("vendor"))).toBe(false);
});

test("listLabeledFiles tolerates a directory that doesn't exist yet", () => {
  const files = listLabeledFiles([{ label: "ghost", path: join(root, "does-not-exist") }]);
  expect(files).toEqual([]);
});

test("resolveLabeledFile maps a labeled path back to its real filesystem path", () => {
  const abs = resolveLabeledFile(dirs, "backend/src/controllers/tasks.ts");
  expect(abs).toBe(join(root, "backend", "src", "controllers", "tasks.ts"));
});

test("resolveLabeledFile returns null for a path with no matching label prefix", () => {
  expect(resolveLabeledFile(dirs, "unknown-area/x.ts")).toBeNull();
});

test("resolveLabeledFile picks the correct dir when multiple labels are present", () => {
  expect(resolveLabeledFile(dirs, "frontend/app/page.tsx")).toBe(join(root, "frontend", "app", "page.tsx"));
});

// 2026-07-12: real bug found live — Navya called read_file on the identical
// path 20 times in a row, burning the full 30-iteration budget before
// falling through to a vague "Max iterations reached" message. detectStuckLoop
// is the pure check the loop uses to exit early with a clear diagnostic.
test("detectStuckLoop is false when fewer signatures than the threshold have accumulated", () => {
  expect(detectStuckLoop(["read_file:a", "read_file:a"], 3)).toBe(false);
});

test("detectStuckLoop is true when the last N signatures are all identical", () => {
  expect(detectStuckLoop(["list_files:{}", "read_file:a", "read_file:a", "read_file:a"], 3)).toBe(true);
});

test("detectStuckLoop is false when the last N signatures include any variation", () => {
  expect(detectStuckLoop(["read_file:a", "read_file:b", "read_file:a"], 3)).toBe(false);
});

test("detectStuckLoop only looks at the trailing window, not the whole history", () => {
  // 3 identical calls happened early, then the agent moved on — not currently stuck.
  expect(detectStuckLoop(["read_file:a", "read_file:a", "read_file:a", "read_file:b", "read_file:c"], 3)).toBe(false);
});
