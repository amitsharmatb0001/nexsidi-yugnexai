// Write rules for builder teams (2026-10-24, docs/plan/2026-10-24-final-plan.md section 3). A builder's helpers write at
// the same time, so each may write only its own work: its tasks' files (taken from the approved plan, where no two tasks
// share a file), new files in its tasks' own folders, and tests beside them. Shared files (layout, theme, API client)
// and other helpers' files are refused by the write guard; a helper that needs a shared change says so and the lead
// makes it. The lead's shared-files step may write anything except the tasks' own files.
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import type { AgentRunConfig } from "./loop.ts";

const norm = (p: string) => p.split("\\").join("/").replace(/^\.\//, "");

export function helperWritable(sandboxDir: string, ownFiles: string[]): (relPath: string) => boolean {
  const own = new Set(ownFiles.map(norm));
  const ownDirs = new Set([...own].map((f) => dirname(f)));
  return (relPath) => {
    const p = norm(relPath);
    if (own.has(p)) return true;
    if (!ownDirs.has(dirname(p))) return false;
    if (/\.test\.(ts|tsx|js)$/.test(p)) return true;
    return !existsSync(join(sandboxDir, p)); // a new file in its own folder, never an existing one
  };
}

export function leadSharedWritable(taskFiles: string[]): (relPath: string) => boolean {
  const tasks = new Set(taskFiles.map(norm));
  return (relPath) => !tasks.has(norm(relPath));
}

/** Task files from the approved plan that are not on disk (the plan-vs-code check of a team step). */
export function missingFiles(sandboxDir: string, files: string[]): string[] {
  return files.filter((f) => !existsSync(join(sandboxDir, f))).map((f) => `${f} is in your tasks but was not written`);
}

/** Runs the compiled backend unit tests (dist/**\/*.test.js) once, after the lead's build; returns their failures. */
export function backendUnitTestFailures(backendDir: string): string[] {
  const dist = join(backendDir, "dist");
  if (!existsSync(dist)) return [];
  const tests: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const full = join(d, n);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.test\.js$/.test(n)) tests.push(full);
    }
  };
  walk(dist);
  if (tests.length === 0) return [];
  const r = spawnSync(process.execPath.includes("bun") ? "node" : process.execPath, ["--test", ...tests], { cwd: backendDir, encoding: "utf-8", timeout: 120_000 });
  if (r.status === 0) return [];
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const failing = out.split("\n").filter((l) => /^not ok|^\s+(error|expected|actual):/i.test(l.trim()) || /^not ok/.test(l)).slice(0, 20);
  return [`unit tests failed (node --test): ${failing.join(" | ").slice(0, 1500) || out.slice(-800)}`];
}

type Overrides = Partial<Pick<AgentRunConfig,
  "geminiTier" | "firstModelIndex" | "writableFile" | "requiredVerificationCommands" | "requiredEvidenceKinds" |
  "requiredEvidenceCounts" | "enableDockerTools" | "enableHttpTools" | "enableBrowser" | "preloadOwnFiles" | "exitChecks" | "blockedTools">>;

/**
 * The settings a team step adds to a builder's run (spread last, so they win). Helpers: the flash tier starting on their
 * own model, only their own files, type check only (no build, containers or browser — those would collide with the other
 * helpers; the lead runs them once). Lead steps: the pro tier ("complex work", Amit 2026-10-24). The lead's finish check
 * compares the code to the plan (every task file exists), keeps the phase's own checks and runs the backend unit tests.
 */
export function teamRunOverrides(
  phase: { role?: "shared" | "helper" | "integrate"; ownFiles?: string[]; avoidFiles?: string[]; helperIndex?: number } | undefined,
  sandboxDir: string,
  opts: { taskFiles: string[]; baseExitChecks?: () => string[] | Promise<string[]>; runBackendTests?: boolean },
): Overrides {
  if (!phase?.role) return {};
  // Helpers and the shared step share the folder with other runs at the same time: no whole-folder rollback, no containers,
  // no nested sub-agents.
  const quiet = {
    requiredEvidenceKinds: [],
    requiredEvidenceCounts: {},
    enableDockerTools: false,
    enableHttpTools: false,
    enableBrowser: false,
    blockedTools: ["rollback_workspace", "docker_compose", "spawn_subagent"],
  };
  if (phase.role === "helper") {
    const own = phase.ownFiles ?? [];
    return {
      ...quiet,
      geminiTier: "generation",
      firstModelIndex: phase.helperIndex ?? 0,
      writableFile: helperWritable(sandboxDir, own),
      requiredVerificationCommands: ["npx tsc --noEmit"],
      preloadOwnFiles: true,
      exitChecks: () => missingFiles(sandboxDir, own),
    };
  }
  if (phase.role === "shared") {
    return { ...quiet, geminiTier: "design", writableFile: leadSharedWritable(phase.avoidFiles ?? []), requiredVerificationCommands: ["npx tsc --noEmit"] };
  }
  return {
    geminiTier: "design",
    exitChecks: async () => [
      ...missingFiles(sandboxDir, opts.taskFiles),
      ...(opts.baseExitChecks ? await opts.baseExitChecks() : []),
      ...(opts.runBackendTests ? backendUnitTestFailures(sandboxDir) : []),
    ],
  };
}
