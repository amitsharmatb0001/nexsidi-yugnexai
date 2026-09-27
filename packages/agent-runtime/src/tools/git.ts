import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function normalizeGitOutput(output: string | Buffer): string {
  return (typeof output === "string" ? output : output.toString("utf-8")).trim();
}

export function execGit(cwd: string, args: string): string {
  try {
    const output = execSync(`git ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }) as unknown as string | Buffer;
    return normalizeGitOutput(output);
  } catch (err) {
    throw new Error(`Git command failed: git ${args}. Reason: ${String(err)}`);
  }
}

export function isGitRepo(cwd: string): boolean {
  try {
    execGit(cwd, "rev-parse --is-inside-work-tree");
    return true;
  } catch {
    return false;
  }
}

// 2026-09-27 (confidentiality): real leak found live — build folders were
// committed with `git add -A` and no .gitignore, so every delivered repo
// carried the pipeline's own files: agent histories (full internal system
// prompts, internal agent names), logs and QA notes. CLAUDE.md: internal
// architecture and agent names must never reach a customer. Top-level only
// (leading "/"), so an app's own backend/logs/ is still committed. dist/ is
// deliberately absent: vendored packages (frontend/vendor/*/dist) ship it.
export const DELIVERY_GITIGNORE_LINES = [
  "# Build-system files (not part of the delivered app)",
  "/history-*.json",
  "/logs/",
  "/qa-submissions.json",
  "*.jsonl",
  "/checkpoints/",
  "/planner-plan.json",
  "node_modules/",
  ".next/",
  "tsconfig.tsbuildinfo",
];

/** Creates or extends `dir/.gitignore` so the pipeline's own files are never committed. Idempotent. */
export function ensureDeliveryGitignore(dir: string): void {
  const path = join(dir, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const present = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const missing = DELIVERY_GITIGNORE_LINES.filter((l) => !present.has(l));
  if (missing.length === 0) return;
  const prefix = existing === "" || existing.endsWith("\n") ? existing : `${existing}\n`;
  writeFileSync(path, `${prefix}${missing.join("\n")}\n`, "utf-8");
}

export function initWorkspaceTransaction(cwd: string): void {
  try {
    if (!isGitRepo(cwd)) {
      // Only for a repo created here: an existing repo (possibly not a build
      // folder at all) keeps its own ignore rules.
      ensureDeliveryGitignore(cwd);
      execGit(cwd, "init");
      execGit(cwd, 'config --local user.name "NexSidi Agent"');
      execGit(cwd, 'config --local user.email "agent@nexsidi.local"');
    }
    // Commit any initial files if repository is clean or dirty
    execGit(cwd, "add -A");
    try {
      execGit(cwd, 'commit -m "nexsidi-initial-state"');
    } catch {
      // Ignore "nothing to commit" errors
    }
  } catch (err) {
    console.warn(`[git-tx] Failed to initialize git transaction workspace: ${String(err)}`);
  }
}

export function commitWorkspaceTransaction(cwd: string, message: string): void {
  try {
    execGit(cwd, "add -A");
    execGit(cwd, `commit -am "nexsidi-checkpoint: ${message}"`);
  } catch (err) {
    // Ignore "nothing to commit" errors, fail-safe
  }
}

export function rollbackWorkspaceTransaction(cwd: string): void {
  try {
    execGit(cwd, "reset --hard HEAD");
    execGit(cwd, "clean -fd");
    console.log(`[git-tx] Rolled back workspace changes in ${cwd} to last commit.`);
  } catch (err) {
    throw new Error(`Workspace rollback failed: ${String(err)}`);
  }
}
