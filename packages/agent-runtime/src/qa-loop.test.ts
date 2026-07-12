import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listLabeledFiles, resolveLabeledFile, detectStuckLoop, type LabeledDir } from "./qa-loop.ts";

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
