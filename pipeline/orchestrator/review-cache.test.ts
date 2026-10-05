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

// 2026-10-05 (Ledgerly run 4): a reviewer had passed the whole app; one builder fix then changed ONE file
// (authRoutes.ts), and all three reviewers read the entire app again — about $2 to re-check code they had
// already passed. A reviewer that passed earlier now reads only the files that changed since that pass.
test("after a change, a reviewer that passed before is asked to read only the changed files", async () => {
  const dirs = setup();
  writeFileSync(join(root, "app", "src", "b.ts"), "export const b = 1;");
  const seen: Array<string[] | undefined> = [];
  const run = async (changed?: string[]) => { seen.push(changed); return passed; };
  await withReviewCache("p2", "navya", dirs, run); // first run: nothing passed yet -> reads everything
  writeFileSync(join(root, "app", "src", "a.ts"), "export const a = 2;");
  await withReviewCache("p2", "navya", dirs, run);
  expect(seen[0]).toBeUndefined();
  expect(seen[1]).toEqual(["backend/src/a.ts"]);
});

test("a new file counts as changed, and the next change is measured from the latest pass", async () => {
  const dirs = setup();
  const seen: Array<string[] | undefined> = [];
  const run = async (changed?: string[]) => { seen.push(changed); return passed; };
  await withReviewCache("p3", "karan", dirs, run);
  writeFileSync(join(root, "app", "src", "c.ts"), "export const c = 1;");
  await withReviewCache("p3", "karan", dirs, run);
  writeFileSync(join(root, "app", "src", "a.ts"), "export const a = 5;");
  await withReviewCache("p3", "karan", dirs, run);
  expect(seen[1]).toEqual(["backend/src/c.ts"]);
  expect(seen[2]).toEqual(["backend/src/a.ts"]);
});

test("a reviewer that never passed reads everything, and a failed review does not become the baseline", async () => {
  const dirs = setup();
  const seen: Array<string[] | undefined> = [];
  const fail = async (changed?: string[]) => { seen.push(changed); return { ...passed, passed: false, score: 50 }; };
  await withReviewCache("p4", "deepika", dirs, fail);
  writeFileSync(join(root, "app", "src", "a.ts"), "export const a = 3;");
  await withReviewCache("p4", "deepika", dirs, fail);
  expect(seen).toEqual([undefined, undefined]);
});

test("a change list the caller already has is kept as it is", async () => {
  const dirs = setup();
  const seen: Array<string[] | undefined> = [];
  const run = async (changed?: string[]) => { seen.push(changed); return passed; };
  await withReviewCache("p5", "navya", dirs, run);
  writeFileSync(join(root, "app", "src", "a.ts"), "export const a = 7;");
  await withReviewCache("p5", "navya", dirs, run, undefined, ["backend/src/x.ts"]);
  expect(seen[1]).toEqual(["backend/src/x.ts"]);
});
