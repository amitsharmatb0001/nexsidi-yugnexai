import { test, expect } from "bun:test";
import { checkFindingsEvidence, checkReviewCoverage, checkChangedFilesCoverage } from "./finding-evidence.ts";

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
// file out of ~15 listed, then submitted an empty findings array.
//
// 2026-07-26 (agent-autonomy-assessment root-cause, live proof): the
// original fix for that (MIN_FILES_READ = 5, flat, never scaled) turned
// into a much worse bug at real scale. On complex1 (84 reviewable files)
// each QA agent could legally conclude after reading 5 — 6% of the
// codebase. Confirmed live: across 4 full QA rounds, Karan had still only
// ever read 46/84 files, Navya and Deepika 29/84 each. A CRITICAL
// privilege-escalation bug in authController.ts sat unreviewed for 3
// rounds not because anything was hard to find, but because nobody had
// opened the file yet — "new bugs every round" was really "the review
// never finished."
//
// Checked Claude Code's and Codex's own real system prompts (not
// assumption): neither uses a numeric read-count floor anywhere. Claude
// Code's Explore.md explicitly warns it must NOT be used for review
// because it "reads excerpts... will miss content." Claude Code's actual
// code-review skill bounds scope to the diff, then requires COMPLETE
// reading within that bound ("Read every hunk in the diff, line by
// line"). NexSidi's QA has an equivalent bound already sitting unused:
// list_files' own manifest. The fix is exactly that shape — complete
// coverage of the bounded scope, not a percentage sample of everything.
test("checkReviewCoverage rejects any read count short of the full file list", () => {
  const result = checkReviewCoverage(46, 84);
  expect(result.allowed).toBe(false);
  expect(result.reason).toContain("46 of 84");
});

test("checkReviewCoverage allows only once every listed file has been read", () => {
  expect(checkReviewCoverage(83, 84).allowed).toBe(false);
  expect(checkReviewCoverage(84, 84).allowed).toBe(true);
});

test("checkReviewCoverage allows a review of an empty/near-empty project trivially", () => {
  expect(checkReviewCoverage(0, 0).allowed).toBe(true);
});

// ── checkChangedFilesCoverage (token-waste-reduction plan, Task 1) ─────────
// Round-2+ gate: requires every CHANGED file to have been read, not every
// file in the whole project — checkReviewCoverage above stays the round-1
// gate, completely unchanged.
test("checkChangedFilesCoverage rejects when a changed file hasn't been read yet", () => {
  const result = checkChangedFilesCoverage(new Set(["backend/src/index.ts"]), ["backend/src/index.ts", "backend/src/routes/index.ts"]);
  expect(result.allowed).toBe(false);
  expect(result.reason).toContain("backend/src/routes/index.ts");
});

test("checkChangedFilesCoverage allows once every changed file has been read, even if the project has many more unread files", () => {
  const readFiles = new Set(["backend/src/index.ts", "backend/src/routes/index.ts"]);
  const result = checkChangedFilesCoverage(readFiles, ["backend/src/index.ts", "backend/src/routes/index.ts"]);
  expect(result.allowed).toBe(true);
});

test("checkChangedFilesCoverage allows trivially when the changed-files list is empty", () => {
  expect(checkChangedFilesCoverage(new Set(), []).allowed).toBe(true);
});

test("checkChangedFilesCoverage does not care about files read that AREN'T in the changed list — reading extra is fine", () => {
  const readFiles = new Set(["backend/src/index.ts", "backend/src/unrelated.ts"]);
  const result = checkChangedFilesCoverage(readFiles, ["backend/src/index.ts"]);
  expect(result.allowed).toBe(true);
});
