import { expect, test } from "bun:test";
import { patchToBeforeAfter } from "./patch";

test("reconstructs both sides from a single-hunk patch", () => {
  const patch = [
    "diff --git a/app.ts b/app.ts",
    "index 1234567..89abcde 100644",
    "--- a/app.ts",
    "+++ b/app.ts",
    "@@ -1,3 +1,3 @@",
    " const a = 1;",
    "-const b = 2;",
    "+const b = 3;",
    " const c = 4;",
  ].join("\n");

  expect(patchToBeforeAfter(patch)).toEqual({
    before: "const a = 1;\nconst b = 2;\nconst c = 4;",
    after: "const a = 1;\nconst b = 3;\nconst c = 4;",
  });
});

test("keeps hunks in order and separates them, so line context is not merged", () => {
  const patch = [
    "@@ -1,2 +1,2 @@",
    " one",
    "-two",
    "+TWO",
    "@@ -10,2 +10,2 @@",
    " ten",
    "-eleven",
    "+ELEVEN",
  ].join("\n");

  const { before, after } = patchToBeforeAfter(patch);
  expect(before.split("\n")).toEqual(["one", "two", "ten", "eleven"]);
  expect(after.split("\n")).toEqual(["one", "TWO", "ten", "ELEVEN"]);
});

test("an addition-only patch yields an empty before side", () => {
  const patch = ["--- /dev/null", "+++ b/new.ts", "@@ -0,0 +1,2 @@", "+line one", "+line two"].join(
    "\n",
  );
  expect(patchToBeforeAfter(patch)).toEqual({ before: "", after: "line one\nline two" });
});

test("a deletion-only patch yields an empty after side", () => {
  const patch = ["--- a/gone.ts", "+++ /dev/null", "@@ -1,2 +0,0 @@", "-line one", "-line two"].join(
    "\n",
  );
  expect(patchToBeforeAfter(patch)).toEqual({ before: "line one\nline two", after: "" });
});

test("treats the no-newline marker as metadata, not as content", () => {
  const patch = ["@@ -1 +1 @@", "-old", "\\ No newline at end of file", "+new"].join("\n");
  expect(patchToBeforeAfter(patch)).toEqual({ before: "old", after: "new" });
});

test("does not mistake a --- or +++ inside the body for a file header", () => {
  // A real hazard: content lines are prefixed, so a removed line whose text
  // begins with "--" arrives as "---...". Only the header *before any hunk*
  // may be treated as metadata.
  const patch = ["@@ -1,2 +1,2 @@", "---- a rule line", "+++++ a wider rule", " kept"].join("\n");
  expect(patchToBeforeAfter(patch)).toEqual({
    before: "--- a rule line\nkept",
    after: "++++ a wider rule\nkept",
  });
});

test("an empty patch is not an error", () => {
  expect(patchToBeforeAfter("")).toEqual({ before: "", after: "" });
});
