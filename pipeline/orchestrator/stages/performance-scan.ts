// Runs the performance checks over a project's generated code (patent claim 9) and turns them into leads for the performance
// reviewer: the growth estimate of the functions that matter, leak patterns, and what got worse since the previous QA round.
// No model is used. Each call also records a snapshot, so the next round can be compared with this one.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { analyzeComplexity, type FunctionComplexity } from "../../../packages/agent-runtime/src/performance/complexity.ts";
import { findLeakPatterns, type LeakPattern } from "../../../packages/agent-runtime/src/performance/leaks.ts";
import { appendSnapshot, buildSnapshot, compareSnapshots, loadHistory, type Regression } from "../../../packages/agent-runtime/src/performance/regression.ts";

export interface PerformanceScanResult {
  concerns: FunctionComplexity[];
  leakPatterns: LeakPattern[];
  regressions: Regression[];
  filesAnalysed: number;
  /** How many earlier rounds there were to compare with. */
  previousRounds: number;
}

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", ".nexsidi", "vendor"]);

function walk(dir: string, rel = ""): string[] {
  let names: string[];
  try {
    names = readdirSync(join(dir, rel));
  } catch {
    return [];
  }
  return names.flatMap((n) => {
    const path = rel ? `${rel}/${n}` : n;
    if (SKIP_DIRS.has(n)) return [];
    try {
      return statSync(join(dir, path)).isDirectory() ? walk(dir, path) : [path];
    } catch {
      return [];
    }
  });
}

/** `record: false` looks without adding this round to the history. */
export function scanBuildDirForPerformance(buildDir: string, opts: { record?: boolean } = {}): PerformanceScanResult {
  const empty: PerformanceScanResult = { concerns: [], leakPatterns: [], regressions: [], filesAnalysed: 0, previousRounds: 0 };
  if (!existsSync(buildDir)) return empty;
  const files: Array<{ path: string; source: string }> = [];
  for (const rel of walk(buildDir)) {
    if (!/^(?:backend|frontend)\/.*\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(rel)) continue;
    try {
      files.push({ path: rel, source: readFileSync(join(buildDir, rel), "utf8") });
    } catch {
      // unreadable file: skipped
    }
  }
  const concerns = files.flatMap((f) => analyzeComplexity(f.path, f.source, { onlyConcerns: true }));
  const leakPatterns = files.flatMap((f) => findLeakPatterns(f.path, f.source));
  const history = loadHistory(buildDir);
  const snapshot = buildSnapshot(files);
  const regressions = compareSnapshots(history[history.length - 1] ?? null, snapshot);
  if (opts.record !== false) appendSnapshot(buildDir, snapshot);
  return { concerns, leakPatterns, regressions, filesAnalysed: files.length, previousRounds: history.length };
}

/** Leads for the reviewer: regressions first, then leaks, then server functions, then page components. "" when nothing was found. */
export function formatPerformanceForReviewer(r: PerformanceScanResult, limit = 20): string {
  const lines: string[] = [];
  for (const g of r.regressions) lines.push(`- [WORSE THAN LAST ROUND] ${g.message}`);
  for (const p of r.leakPatterns) lines.push(`- [LEAK PATTERN] ${p.file}:${p.line} ${p.message}`);
  const rank = (f: FunctionComplexity) => (f.kind === "component" ? 1 : 0);
  for (const f of [...r.concerns].sort((a, b) => rank(a) - rank(b) || b.degree - a.degree)) {
    const calls = f.callsInLoop.length ? `; ${f.callsInLoop.map((c) => `${c.call} at line ${c.line}`).join(", ")} runs once per item` : "";
    lines.push(`- [${f.estimate}] ${f.file}:${f.line} ${f.name}${f.kind === "component" ? " (page component: n is the length of a list on screen, usually small)" : ""}${calls}`);
  }
  if (lines.length === 0) return "";
  const shown = lines.slice(0, limit);
  const more = lines.length > limit ? `\n(${lines.length - limit} more not shown)` : "";
  return `AUTOMATED PERFORMANCE SCAN (growth estimated from the structure of the code, ${r.filesAnalysed} files; ${r.previousRounds} earlier round(s) to compare with). These are leads, not measurements: the real size of n is not known. Confirm each one before reporting it.\n${shown.join("\n")}${more}`;
}
