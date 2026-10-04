import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprintCode, withReviewCache } from "./review-cache.ts";

// 2026-10-04 (Ledgerly run 4): a restart re-ran all three reviewers on code
// that had not changed since they passed — about $3 to learn nothing, and a
// fresh roll of a review that is not repeatable. A reviewer that passed on
// this exact code is not run again; any change to the code runs it.
const prevBuild = process.env.BUILD_DIR;
const prevFlag = process.env.QA_REVIEW_CACHE_ENABLED;
let root = "";
afterEach(() => {
  process.env.BUILD_DIR = prevBuild;
  if (prevFlag === undefined) delete process.env.QA_REVIEW_CACHE_ENABLED; else process.env.QA_REVIEW_CACHE_ENABLED = prevFlag;
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});
const setup = () => {
  root = mkdtempSync(join(tmpdir(), "review-cache-"));
  process.env.BUILD_DIR = root;
  mkdirSync(join(root, "app", "src"), { recursive: true });
  writeFileSync(join(root, "app", "src", "a.ts"), "export const a = 1;");
  return [{ label: "backend", path: join(root, "app") }];
};
const passed = { agent: "navya", score: 100, passed: true, findings: [] as unknown[] };

test("the fingerprint is stable, and changes when any reviewed file changes", () => {
  const dirs = setup();
  const a = fingerprintCode(dirs);
  expect(fingerprintCode(dirs)).toBe(a);
  writeFileSync(join(root, "app", "src", "a.ts"), "export const a = 2;");
  expect(fingerprintCode(dirs)).not.toBe(a);
});

test("files nobody reviews (lockfiles, the component library) do not change the fingerprint", () => {
  const dirs = setup();
  const a = fingerprintCode(dirs);
  writeFileSync(join(root, "app", "package-lock.json"), "{}");
  mkdirSync(join(root, "app", "components", "nexui"), { recursive: true });
  writeFileSync(join(root, "app", "components", "nexui", "x.tsx"), "x");
  expect(fingerprintCode(dirs)).toBe(a);
});

test("a reviewer that passed on this exact code is skipped next time", async () => {
  const dirs = setup();
  let runs = 0;
  const run = async () => { runs++; return passed; };
  await withReviewCache("p1", "navya", dirs, run);
  const second = await withReviewCache("p1", "navya", dirs, run);
  expect(runs).toBe(1);
  expect(second).toEqual(passed);
});

test("any change to the code runs the reviewer again", async () => {
  const dirs = setup();
  let runs = 0;
  const run = async () => { runs++; return passed; };
  await withReviewCache("p1", "navya", dirs, run);
  writeFileSync(join(root, "app", "src", "a.ts"), "export const a = 99;");
  await withReviewCache("p1", "navya", dirs, run);
  expect(runs).toBe(2);
});

test("a review that failed is never cached, and each reviewer has its own entry", async () => {
  const dirs = setup();
  let runs = 0;
  const fail = async () => { runs++; return { ...passed, passed: false, score: 60 }; };
  await withReviewCache("p1", "karan", dirs, fail);
  await withReviewCache("p1", "karan", dirs, fail);
  expect(runs).toBe(2);
  let navyaRuns = 0;
  await withReviewCache("p1", "navya", dirs, async () => { navyaRuns++; return passed; });
  await withReviewCache("p1", "navya", dirs, async () => { navyaRuns++; return passed; });
  expect(navyaRuns).toBe(1);
});

test("the cache can be switched off with QA_REVIEW_CACHE_ENABLED=false", async () => {
  const dirs = setup();
  process.env.QA_REVIEW_CACHE_ENABLED = "false";
  let runs = 0;
  const run = async () => { runs++; return passed; };
  await withReviewCache("p1", "navya", dirs, run);
  await withReviewCache("p1", "navya", dirs, run);
  expect(runs).toBe(2);
});

test("the real review entry point wraps all three reviewers", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("./stages/stage5-adversarial-qa.ts", import.meta.url), "utf-8");
  expect((src.match(/withReviewCache\(projectId, "(navya|karan|deepika)"/g) ?? []).length).toBe(3);
});
