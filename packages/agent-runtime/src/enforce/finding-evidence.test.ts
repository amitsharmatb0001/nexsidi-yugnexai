import { test, expect } from "bun:test";
import { checkFindingsEvidence, checkReviewCoverage } from "./finding-evidence.ts";

test("allows findings with no file field at all (severity/category-only observations)", () => {
  const result = checkFindingsEvidence([{}], new Set());
  expect(result.allowed).toBe(true);
});

test("allows a finding citing a file that was actually read", () => {
  const result = checkFindingsEvidence(
    [{ file: "backend/src/controllers/tasks.ts" }],
    new Set(["backend/src/controllers/tasks.ts"]),
  );
  expect(result.allowed).toBe(true);
});

test("rejects a finding citing a file that was never read", () => {
  const result = checkFindingsEvidence(
    [{ file: "backend/src/controllers/tasks.ts" }],
    new Set(),
  );
  expect(result.allowed).toBe(false);
  expect(result.reason).toContain("backend/src/controllers/tasks.ts");
});

test("rejects the whole batch if even one finding among several is unverified", () => {
  const result = checkFindingsEvidence(
    [
      { file: "backend/src/controllers/tasks.ts" },
      { file: "backend/src/routes/index.ts" },
    ],
    new Set(["backend/src/controllers/tasks.ts"]),
  );
  expect(result.allowed).toBe(false);
  expect(result.reason).toContain("backend/src/routes/index.ts");
  expect(result.reason).not.toContain("backend/src/controllers/tasks.ts,"); // the verified one isn't listed
});

test("empty findings array is always allowed", () => {
  expect(checkFindingsEvidence([], new Set()).allowed).toBe(true);
});

test("does not double-count the same unverified file cited by multiple findings", () => {
  const result = checkFindingsEvidence(
    [{ file: "backend/x.ts" }, { file: "backend/x.ts" }],
    new Set(),
  );
  expect(result.allowed).toBe(false);
  expect(result.reason).toBe(
    "2 finding(s) cite a file you never called read_file on: backend/x.ts. Call read_file on each cited file to verify the claim before submitting, or drop the finding if it doesn't hold up.",
  );
});

// 2026-07-11: real bug found live — Deepika's smoke test read exactly ONE
// file out of ~15 listed, then submitted an empty findings array. The
// evidence gate above stops it from citing a file it never read, but does
// nothing to stop it from barely looking at all — a "clean" result from
// reading 1/15 files isn't credible. This requires a minimum spread of
// reading before a review can conclude, scaled down for small projects so
// it's never an impossible bar.

test("checkReviewCoverage rejects when far fewer files were read than exist", () => {
  const result = checkReviewCoverage(1, 15);
  expect(result.allowed).toBe(false);
  expect(result.reason).toContain("1 of 15");
});

test("checkReviewCoverage allows once the minimum (5, or all files if fewer) has been read", () => {
  expect(checkReviewCoverage(5, 15).allowed).toBe(true);
  expect(checkReviewCoverage(15, 15).allowed).toBe(true);
});

test("checkReviewCoverage scales the requirement down for small projects — never impossible to satisfy", () => {
  // only 3 files exist total — can't demand reading 5
  expect(checkReviewCoverage(3, 3).allowed).toBe(true);
  expect(checkReviewCoverage(2, 3).allowed).toBe(false);
});

test("checkReviewCoverage allows a review of an empty/near-empty project trivially", () => {
  expect(checkReviewCoverage(0, 0).allowed).toBe(true);
});
