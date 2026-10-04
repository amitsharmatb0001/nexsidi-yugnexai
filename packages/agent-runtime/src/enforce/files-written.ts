// 2026-10-04 (Ledgerly run 4): edit_file and delete_file were never recorded as
// changed files, only write_file/write_files were. Builders fix code with
// edit_file, so an edit-only fix was reported as "changed nothing": the stage
// held a run whose code had really been fixed, and the next review round got an
// empty changed-files list and re-read the whole project. Every tool that
// changes a file is recorded here, once per path, only when it succeeded.
export function trackWrittenFile(
  filesWritten: string[],
  tool: string,
  args: { path?: string },
  status: "success" | "error",
): void {
  if (status !== "success") return;
  if (tool !== "edit_file" && tool !== "delete_file") return;
  const path = args.path;
  if (path && !filesWritten.includes(path)) filesWritten.push(path);
}
