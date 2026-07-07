import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execWriteFile, execEditFile, execDeleteFile } from "./file.ts";

// Full-system audit L2: a model sometimes sends write_file's `content`
// argument as a JSON object instead of a string (observed in stress-test
// run 7, iterations 9-14 — the SAME wrong shape sent 5 times in a row,
// because writeFileSync's generic TypeError taught the model nothing about
// what was actually wrong). Coercing here means the write succeeds with
// reasonable content on the first attempt instead of costing 5 more
// iterations to discover the fix.

let sandboxDir: string;
beforeEach(() => {
  sandboxDir = mkdtempSync(join(tmpdir(), "nexsidi-file-test-"));
});
afterEach(() => {
  rmSync(sandboxDir, { recursive: true, force: true });
});

test("string content writes exactly as given (unchanged behavior)", () => {
  const result = execWriteFile(sandboxDir, { path: "a.ts", content: "export const x = 1;" });
  expect(result.status).toBe("success");
  expect(readFileSync(join(sandboxDir, "a.ts"), "utf-8")).toBe("export const x = 1;");
});

test("object content is coerced to formatted JSON instead of throwing", () => {
  const result = execWriteFile(sandboxDir, {
    path: "package.json",
    content: { name: "x", version: "1.0.0" } as unknown as string,
  });
  expect(result.status).toBe("success");
  const written = readFileSync(join(sandboxDir, "package.json"), "utf-8");
  expect(JSON.parse(written)).toEqual({ name: "x", version: "1.0.0" });
});

test("array content is also coerced rather than throwing", () => {
  const result = execWriteFile(sandboxDir, {
    path: "list.json",
    content: [1, 2, 3] as unknown as string,
  });
  expect(result.status).toBe("success");
  expect(JSON.parse(readFileSync(join(sandboxDir, "list.json"), "utf-8"))).toEqual([1, 2, 3]);
});

// Phase B, L7 (full-system audit): agents were rewriting whole files via
// write_file for single-line changes, burning output tokens re-emitting
// unchanged content. execEditFile mirrors Anthropic's own text-editor
// str_replace command: exactly one match required, or it's an error.

test("edit_file replaces a unique match and leaves the rest of the file untouched", () => {
  writeFileSync(join(sandboxDir, "a.ts"), "export const x = 1;\nexport const y = 2;\n");
  const result = execEditFile(sandboxDir, { path: "a.ts", old_str: "const x = 1;", new_str: "const x = 100;" });
  expect(result.status).toBe("success");
  expect(readFileSync(join(sandboxDir, "a.ts"), "utf-8")).toBe("export const x = 100;\nexport const y = 2;\n");
});

test("edit_file errors when old_str is not found in the file", () => {
  writeFileSync(join(sandboxDir, "a.ts"), "export const x = 1;\n");
  const result = execEditFile(sandboxDir, { path: "a.ts", old_str: "const z = 9;", new_str: "const z = 10;" });
  expect(result.status).toBe("error");
  expect(result.summary).toContain("not found");
  expect(readFileSync(join(sandboxDir, "a.ts"), "utf-8")).toBe("export const x = 1;\n"); // unchanged
});

test("edit_file errors when old_str matches more than once, and does not modify the file", () => {
  writeFileSync(join(sandboxDir, "a.ts"), "const x = 1;\nconst x = 1;\n");
  const result = execEditFile(sandboxDir, { path: "a.ts", old_str: "const x = 1;", new_str: "const x = 2;" });
  expect(result.status).toBe("error");
  expect(result.summary).toContain("2 times");
  expect(readFileSync(join(sandboxDir, "a.ts"), "utf-8")).toBe("const x = 1;\nconst x = 1;\n"); // unchanged
});

test("edit_file errors when the target file does not exist", () => {
  const result = execEditFile(sandboxDir, { path: "missing.ts", old_str: "a", new_str: "b" });
  expect(result.status).toBe("error");
  expect(result.summary).toContain("not found");
});

test("edit_file blocks path traversal outside the sandbox", () => {
  const result = execEditFile(sandboxDir, { path: "../../etc/passwd", old_str: "a", new_str: "b" });
  expect(result.status).toBe("error");
});

test("edit_file rejects an empty old_str instead of matching every position in the file", () => {
  writeFileSync(join(sandboxDir, "a.ts"), "const x = 1;\n");
  const result = execEditFile(sandboxDir, { path: "a.ts", old_str: "", new_str: "anything" });
  expect(result.status).toBe("error");
  expect(readFileSync(join(sandboxDir, "a.ts"), "utf-8")).toBe("const x = 1;\n"); // unchanged
});

// Real 2026-07-07 stress-test bug: no delete_file tool existed at all. An
// agent needing to remove a wrongly-created middleware.ts tried `rm` via
// run_command (blocked — not in command.ts's ALLOWED_COMMANDS), then burned
// ~15 iterations on workarounds (node -e "fs.unlinkSync(...)", checking
// existence, writing placeholder content) instead of a direct tool call —
// observed in BOTH the NIM and Gemini escalation paths for the same file.
test("delete_file removes an existing file", () => {
  writeFileSync(join(sandboxDir, "a.ts"), "const x = 1;\n");
  const result = execDeleteFile(sandboxDir, { path: "a.ts" });
  expect(result.status).toBe("success");
  expect(existsSync(join(sandboxDir, "a.ts"))).toBe(false);
});

test("delete_file errors when the target file does not exist", () => {
  const result = execDeleteFile(sandboxDir, { path: "missing.ts" });
  expect(result.status).toBe("error");
  expect(result.summary).toContain("not found");
});

test("delete_file blocks path traversal outside the sandbox", () => {
  const result = execDeleteFile(sandboxDir, { path: "../../etc/passwd" });
  expect(result.status).toBe("error");
});
