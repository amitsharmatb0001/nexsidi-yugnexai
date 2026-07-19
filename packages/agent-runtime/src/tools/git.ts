import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

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

export function initWorkspaceTransaction(cwd: string): void {
  try {
    if (!isGitRepo(cwd)) {
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
