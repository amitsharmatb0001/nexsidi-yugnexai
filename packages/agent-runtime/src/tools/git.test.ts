import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspaceTransaction, commitWorkspaceTransaction, rollbackWorkspaceTransaction } from "./git.ts";

let sandboxDir: string;
beforeEach(() => {
  sandboxDir = mkdtempSync(join(tmpdir(), "nexsidi-git-test-"));
});
afterEach(() => {
  rmSync(sandboxDir, { recursive: true, force: true });
});

test("git workspace transactions", () => {
  // 1. Initialize git transaction workspace
  writeFileSync(join(sandboxDir, "a.txt"), "hello", "utf-8");
  initWorkspaceTransaction(sandboxDir);
  expect(existsSync(join(sandboxDir, ".git"))).toBe(true);

  // 2. Make modification and commit it
  writeFileSync(join(sandboxDir, "a.txt"), "modified hello", "utf-8");
  commitWorkspaceTransaction(sandboxDir, "modified a.txt");

  // 3. Make compiler-breaking change (uncommitted)
  writeFileSync(join(sandboxDir, "a.txt"), "broken code!", "utf-8");
  writeFileSync(join(sandboxDir, "b.txt"), "unwanted file", "utf-8");

  expect(readFileSync(join(sandboxDir, "a.txt"), "utf-8")).toBe("broken code!");
  expect(existsSync(join(sandboxDir, "b.txt"))).toBe(true);

  // 4. Rollback transaction
  rollbackWorkspaceTransaction(sandboxDir);

  // 5. Assert rollback restored modified hello and cleaned unwanted files
  expect(readFileSync(join(sandboxDir, "a.txt"), "utf-8")).toBe("modified hello");
  expect(existsSync(join(sandboxDir, "b.txt"))).toBe(false);
});
