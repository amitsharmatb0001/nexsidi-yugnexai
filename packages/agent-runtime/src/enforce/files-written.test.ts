import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { trackWrittenFile } from "./files-written.ts";

// 2026-10-04 (Ledgerly run 4): a backend fix edited two files with edit_file,
// tested them on the running app, then ended without a clean finish. The run
// reported no files written — edit_file and delete_file were never recorded —
// so the stage judged the round "changed nothing", skipped the redeploy and
// held the whole run. The same gap left the next review round with an empty
// changed-files list, so reviewers re-read the whole project every round.
test("a successful edit_file or delete_file is recorded as a changed file, once", () => {
  const done: string[] = [];
  trackWrittenFile(done, "edit_file", { path: "src/a.ts" }, "success");
  trackWrittenFile(done, "edit_file", { path: "src/a.ts" }, "success");
  trackWrittenFile(done, "delete_file", { path: "src/b.ts" }, "success");
  expect(done).toEqual(["src/a.ts", "src/b.ts"]);
});

test("a failed edit is not recorded, and other tools are ignored", () => {
  const done: string[] = [];
  trackWrittenFile(done, "edit_file", { path: "src/a.ts" }, "error");
  trackWrittenFile(done, "read_file", { path: "src/c.ts" }, "success");
  expect(done).toEqual([]);
});

test("all three agent loops record edit_file and delete_file results", () => {
  for (const f of ["../loop.ts", "../gemini-loop.ts", "../claude-loop.ts"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf-8");
    expect({ f, edit: src.includes('trackWrittenFile(filesWritten, "edit_file"'), del: src.includes('trackWrittenFile(filesWritten, "delete_file"') }).toEqual({ f, edit: true, del: true });
  }
});
