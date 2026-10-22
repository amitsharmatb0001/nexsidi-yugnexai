import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPreloadedCode, buildQaInitialMessage } from "./qa-loop.ts";

// 2026-10-22 (Trailhead rerun, measured from 1,370 model calls): the three code reviewers cost $16.89 of $36.94 (46%)
// and most of the hours. Each read a 53-file app (~37K tokens) one 8,000-character piece at a time, ~160 calls each, every
// call resending the whole conversation: 8-12 million input tokens per reviewer. The code now goes into the reviewer's
// first message (up to a size budget), every included file counts as read, and the reviewer submits in a few calls.
//
// Amit, same day: after any fix the review must cover the WHOLE app, never only the changed files, because one changed
// function can break every page that imports it. The changed-files-only re-review mode is no longer used.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "qa1-"));
  mkdirSync(join(dir, "backend", "src"), { recursive: true });
  mkdirSync(join(dir, "frontend", "app"), { recursive: true });
  writeFileSync(join(dir, "backend", "src", "app.ts"), "export const app = 1;\n");
  writeFileSync(join(dir, "frontend", "app", "page.tsx"), "export default function P() { return null; }\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const dirs = () => [{ label: "backend", path: join(dir, "backend") }, { label: "frontend", path: join(dir, "frontend") }];

test("every file within the budget is included whole, with its labeled path", () => {
  const p = buildPreloadedCode(dirs(), 100_000);
  expect(p.included.sort()).toEqual(["backend/src/app.ts", "frontend/app/page.tsx"]);
  expect(p.omitted).toEqual([]);
  expect(p.text).toContain("=== FILE: backend/src/app.ts ===");
  expect(p.text).toContain("export const app = 1;");
});

test("files past the budget are listed as not included, never cut in half", () => {
  writeFileSync(join(dir, "backend", "src", "big.ts"), "x".repeat(5000));
  const p = buildPreloadedCode(dirs(), 200);
  expect(p.omitted).toContain("backend/src/big.ts");
  expect(p.text).not.toContain("xxxxx");
});

test("the first message says the code is already here and asks for a full review", () => {
  const p = buildPreloadedCode(dirs(), 100_000);
  const msg = buildQaInitialMessage("logic bugs", undefined, undefined, p);
  expect(msg).toContain("The whole codebase is included below");
  expect(msg).toContain("=== FILE: frontend/app/page.tsx ===");
  expect(msg).not.toContain("Call list_files first");
});

test("the reviewer loop preloads the code, counts it as read, and never narrows to changed files", () => {
  const src = readFileSync(new URL("./qa-loop.ts", import.meta.url), "utf-8");
  const fn = src.slice(src.indexOf("export async function runQAAgent"), src.indexOf("export async function extractFindingsFromHistory"));
  expect(fn).toContain("buildPreloadedCode(config.dirs");
  expect(fn).toContain("for (const path of preload.included) readFiles.add(path);");
  expect(fn).toContain("const changedFiles: string[] | undefined = undefined;");
});
