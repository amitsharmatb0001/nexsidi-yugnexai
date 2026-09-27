import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspaceTransaction, commitWorkspaceTransaction, rollbackWorkspaceTransaction, normalizeGitOutput, ensureDeliveryGitignore, DELIVERY_GITIGNORE_LINES } from "./git.ts";

let sandboxDir: string;
beforeEach(() => {
  sandboxDir = mkdtempSync(join(tmpdir(), "nexsidi-git-test-"));
});
afterEach(() => {
  rmSync(sandboxDir, { recursive: true, force: true });
});

test("normalizes Bun Buffer-like execSync output to a trimmed string", () => {
  expect(normalizeGitOutput(Buffer.from("true\r\n"))).toBe("true");
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

// ── Delivery .gitignore (2026-09-27, confidentiality) ────────────────────
// Real leak found live: build folders are committed with `git add -A` and no
// .gitignore, so every delivered repo contained the pipeline's own files —
// agent histories (full internal system prompts, internal agent names), logs
// and QA notes. CLAUDE.md: internal architecture and agent names must never
// reach a customer.

test("ensureDeliveryGitignore creates a .gitignore covering the pipeline's own files", () => {
  ensureDeliveryGitignore(sandboxDir);
  const lines = readFileSync(join(sandboxDir, ".gitignore"), "utf-8").split(/\r?\n/);
  for (const l of ["/history-*.json", "/logs/", "/qa-submissions.json", "*.jsonl", "/checkpoints/", "/planner-plan.json", "node_modules/", ".next/"]) {
    expect(lines).toContain(l);
  }
  expect(DELIVERY_GITIGNORE_LINES).not.toContain("dist/"); // vendored packages ship their dist/
});

test("ensureDeliveryGitignore keeps an existing .gitignore and only appends missing lines (idempotent)", () => {
  writeFileSync(join(sandboxDir, ".gitignore"), "custom-secret.txt\nnode_modules/\n", "utf-8");
  ensureDeliveryGitignore(sandboxDir);
  const once = readFileSync(join(sandboxDir, ".gitignore"), "utf-8");
  expect(once.startsWith("custom-secret.txt\nnode_modules/\n")).toBe(true);
  expect(once.match(/^node_modules\/$/gm)?.length).toBe(1);
  ensureDeliveryGitignore(sandboxDir);
  expect(readFileSync(join(sandboxDir, ".gitignore"), "utf-8")).toBe(once);
});

test("a new workspace transaction never commits the pipeline's own files", () => {
  writeFileSync(join(sandboxDir, "app.ts"), "export {};", "utf-8");
  writeFileSync(join(sandboxDir, "history-tilotma-reality-checker.json"), "[]", "utf-8");
  mkdirSync(join(sandboxDir, "logs"));
  writeFileSync(join(sandboxDir, "logs", "pipeline.log"), "internal", "utf-8");
  mkdirSync(join(sandboxDir, "backend", "logs"), { recursive: true });
  writeFileSync(join(sandboxDir, "backend", "logs", "app.log"), "the app's own log", "utf-8");
  initWorkspaceTransaction(sandboxDir);
  const tracked = execSync("git ls-files", { cwd: sandboxDir, encoding: "utf-8" }).split(/\r?\n/).filter(Boolean);
  expect(tracked).toContain("app.ts");
  expect(tracked).toContain("backend/logs/app.log"); // only the top-level pipeline logs/ is ignored
  expect(tracked).not.toContain("history-tilotma-reality-checker.json");
  expect(tracked).not.toContain("logs/pipeline.log");
});

test("rollback leaves the pipeline's own (ignored) files alone", () => {
  writeFileSync(join(sandboxDir, "app.ts"), "export {};", "utf-8");
  initWorkspaceTransaction(sandboxDir);
  writeFileSync(join(sandboxDir, "history-riya.json"), "[1]", "utf-8");
  rollbackWorkspaceTransaction(sandboxDir);
  expect(readFileSync(join(sandboxDir, "history-riya.json"), "utf-8")).toBe("[1]");
});
