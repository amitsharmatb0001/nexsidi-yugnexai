// Regression detection across iterations (patent claim 9).
//
// After each QA round a snapshot is taken of what the performance checker can see: the estimated growth of every function,
// the calls made inside loops, the leak patterns in the code and, when the app was probed, the response times of its routes
// and how fast its memory climbs. The next round is compared with the one before it. Something got worse when a function's
// estimate went up, a new quadratic function or per-item call appeared, a new leak pattern appeared, a route got both
// 25% and 50 ms slower, or memory began to climb. A function is known by its file and name, not its line, so moving code
// is not a change. Snapshots live in <project>/.nexsidi/perf-history.json.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeComplexity } from "./complexity.ts";
import { findLeakPatterns, type RouteTiming } from "./leaks.ts";

export interface PerfSnapshot {
  takenAt: string;
  functions: Record<string, { degree: number; estimate: string; callsInLoop: number }>;
  leakPatterns: string[];
  routeTimings?: Record<string, RouteTiming>;
  memorySlopeMbPer1000?: number;
}

export interface Regression {
  kind: "complexity" | "new-slow-function" | "calls-in-loop" | "new-leak-pattern" | "route-slower" | "memory-slope";
  subject: string;
  before?: string;
  after: string;
  message: string;
}

export function buildSnapshot(files: Array<{ path: string; source: string }>, extra: Partial<Pick<PerfSnapshot, "routeTimings" | "memorySlopeMbPer1000">> = {}): PerfSnapshot {
  const functions: PerfSnapshot["functions"] = {};
  const leakPatterns = new Set<string>();
  for (const f of files) {
    for (const c of analyzeComplexity(f.path, f.source)) functions[`${c.file}::${c.name}`] = { degree: c.degree, estimate: c.estimate, callsInLoop: c.callsInLoop.length };
    // Line numbers are left out so that moving code does not make an old pattern look new.
    for (const p of findLeakPatterns(f.path, f.source)) leakPatterns.add(`${p.kind}|${p.file}|${p.message.replace(/\(?line \d+\)?/g, "").replace(/\s+/g, " ")}`);
  }
  return { takenAt: new Date().toISOString(), functions, leakPatterns: [...leakPatterns].sort(), ...extra };
}

export function compareSnapshots(prev: PerfSnapshot | null, curr: PerfSnapshot): Regression[] {
  if (!prev) return [];
  const out: Regression[] = [];
  for (const [key, now] of Object.entries(curr.functions)) {
    const name = key.split("::")[1] ?? key;
    const was = prev.functions[key];
    if (was) {
      if (now.degree > was.degree) out.push({ kind: "complexity", subject: key, before: was.estimate, after: now.estimate, message: `${name} went from ${was.estimate} to ${now.estimate}` });
      if (now.callsInLoop > was.callsInLoop) out.push({ kind: "calls-in-loop", subject: key, before: String(was.callsInLoop), after: String(now.callsInLoop), message: `${name} now makes ${now.callsInLoop} database or network call(s) per item (was ${was.callsInLoop})` });
    } else {
      if (now.degree >= 2) out.push({ kind: "new-slow-function", subject: key, after: now.estimate, message: `new function ${name} is ${now.estimate}` });
      if (now.callsInLoop > 0) out.push({ kind: "calls-in-loop", subject: key, after: String(now.callsInLoop), message: `new function ${name} makes ${now.callsInLoop} database or network call(s) per item` });
    }
  }
  const before = new Set(prev.leakPatterns);
  for (const p of curr.leakPatterns) {
    if (!before.has(p)) out.push({ kind: "new-leak-pattern", subject: p.split("|")[1] ?? p, after: p.split("|")[0]!, message: `new leak pattern: ${p.split("|")[2]}` });
  }
  for (const [route, now] of Object.entries(curr.routeTimings ?? {})) {
    const was = prev.routeTimings?.[route];
    if (was && now.p95 > was.p95 * 1.25 && now.p95 - was.p95 > 50) {
      out.push({ kind: "route-slower", subject: route, before: `${was.p95.toFixed(0)} ms`, after: `${now.p95.toFixed(0)} ms`, message: `${route} p95 went from ${was.p95.toFixed(0)} ms to ${now.p95.toFixed(0)} ms` });
    }
  }
  if (prev.memorySlopeMbPer1000 !== undefined && curr.memorySlopeMbPer1000 !== undefined && curr.memorySlopeMbPer1000 >= 1 && curr.memorySlopeMbPer1000 - prev.memorySlopeMbPer1000 >= 2) {
    out.push({ kind: "memory-slope", subject: "memory", before: `${prev.memorySlopeMbPer1000.toFixed(1)} MB/1000 requests`, after: `${curr.memorySlopeMbPer1000.toFixed(1)} MB/1000 requests`, message: `memory now climbs ${curr.memorySlopeMbPer1000.toFixed(1)} MB per 1000 requests (was ${prev.memorySlopeMbPer1000.toFixed(1)})` });
  }
  return out;
}

const historyFile = (buildDir: string) => join(buildDir, ".nexsidi", "perf-history.json");

export function loadHistory(buildDir: string): PerfSnapshot[] {
  try {
    const parsed = JSON.parse(readFileSync(historyFile(buildDir), "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as PerfSnapshot[]) : [];
  } catch {
    return [];
  }
}

/** Adds a snapshot, keeping the newest `keep`. Written whole and moved into place, so a crash never leaves half a file. */
export function appendSnapshot(buildDir: string, snapshot: PerfSnapshot, keep = 20): void {
  const dir = join(buildDir, ".nexsidi");
  mkdirSync(dir, { recursive: true });
  const next = [...loadHistory(buildDir), snapshot].slice(-keep);
  const tmp = `${historyFile(buildDir)}.tmp`;
  writeFileSync(tmp, JSON.stringify(next));
  if (existsSync(tmp)) renameSync(tmp, historyFile(buildDir));
}
