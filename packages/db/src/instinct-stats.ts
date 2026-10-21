// Statistical extraction of recurring mistake patterns (patent claim 7).
//
// Before this, a mistake was kept or strengthened by a bare counter: seen again, confidence one step up. A counter cannot
// tell a real recurring weakness from a one-project accident or from a pattern that is simply common everywhere. This module
// asks: across the projects we have seen, does this pattern show up in more of them than chance would explain?
//
// Method, in plain terms:
//   1. For each pattern, count the DISTINCT projects it appeared in (not how often it repeated inside one project).
//   2. Estimate the background rate: how likely a typical other pattern is to appear in a typical project
//      (leave-one-out, so the pattern under test does not raise its own baseline).
//   3. Exact one-sided binomial test: the chance of seeing the pattern in at least that many projects if it were
//      just background.
//   4. Benjamini-Hochberg correction across all patterns tested, so testing many patterns does not produce winners by luck.
//   5. Minimum evidence: at least `minProjects` distinct projects and `minOccurrences` occurrences, or the pattern is not kept.
// Pure functions, no database access.

export interface Occurrence {
  domain: string;
  trigger: string;
  /** Empty string when the occurrence was recorded without a project (kept for counting, not for cross-project claims). */
  projectId: string;
}

export interface PatternStat {
  domain: string;
  trigger: string;
  occurrences: number;
  projectCount: number;
  pValue: number;
  adjustedPValue: number;
  /** -log10(pValue), capped. Higher means stronger evidence. */
  score: number;
  significant: boolean;
  reason: string;
}

export interface EvaluateOptions {
  /** Number of projects that could have shown the pattern (all projects observed, whether or not they had mistakes). */
  totalProjects: number;
  minProjects?: number;
  minOccurrences?: number;
  alpha?: number;
}

const SCORE_CAP = 12;

/** P(X >= k) for X ~ Binomial(n, p), summed exactly in log space so large n stays accurate. */
export function binomialTail(k: number, n: number, p: number): number {
  if (n <= 0) return 0;
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const logP = Math.log(p);
  const logQ = Math.log(1 - p);
  // log(n!) via a running sum of logs.
  const logFact = [0];
  for (let i = 1; i <= n; i++) logFact.push(logFact[i - 1]! + Math.log(i));
  let total = 0;
  for (let i = k; i <= n; i++) {
    const logTerm = logFact[n]! - logFact[i]! - logFact[n - i]! + i * logP + (n - i) * logQ;
    total += Math.exp(logTerm);
  }
  return Math.min(1, total);
}

export function evaluatePatterns(rows: Occurrence[], opts: EvaluateOptions): PatternStat[] {
  const minProjects = opts.minProjects ?? 3;
  const minOccurrences = opts.minOccurrences ?? 3;
  const alpha = opts.alpha ?? 0.05;

  const byPattern = new Map<string, { domain: string; trigger: string; occurrences: number; projects: Set<string> }>();
  const allProjects = new Set<string>();
  for (const r of rows) {
    const key = `${r.domain}\u0000${r.trigger}`;
    let e = byPattern.get(key);
    if (!e) byPattern.set(key, (e = { domain: r.domain, trigger: r.trigger, occurrences: 0, projects: new Set() }));
    e.occurrences++;
    if (r.projectId) {
      e.projects.add(r.projectId);
      allProjects.add(r.projectId);
    }
  }
  const entries = [...byPattern.values()];
  if (entries.length === 0) return [];

  // The number of projects can never be smaller than the number we actually saw a pattern in.
  const N = Math.max(opts.totalProjects, allProjects.size, 1);
  const M = entries.length;
  const sumProjects = entries.reduce((s, e) => s + e.projects.size, 0);
  // A background rate of exactly zero would make any sighting infinitely significant; keep half a project's worth of doubt.
  const floor = 1 / (2 * N);

  const stats: PatternStat[] = entries.map((e) => {
    const k = e.projects.size;
    const background = M > 1 ? (sumProjects - k) / (N * (M - 1)) : floor;
    const p0 = Math.min(0.999, Math.max(floor, background));
    const pValue = k > 0 ? binomialTail(k, N, p0) : 1;
    const score = Math.min(SCORE_CAP, pValue > 0 ? -Math.log10(pValue) : SCORE_CAP);
    let reason = "";
    if (k < minProjects) reason = `seen in fewer than ${minProjects} distinct projects (${k})`;
    else if (e.occurrences < minOccurrences) reason = `fewer than ${minOccurrences} occurrences (${e.occurrences})`;
    return { domain: e.domain, trigger: e.trigger, occurrences: e.occurrences, projectCount: k, pValue, adjustedPValue: 1, score, significant: false, reason };
  });

  // Benjamini-Hochberg over the patterns that meet the minimum evidence; the others are not tested.
  const testable = stats.filter((s) => s.reason === "").sort((a, b) => a.pValue - b.pValue);
  const m = testable.length;
  let running = 1;
  for (let i = m - 1; i >= 0; i--) {
    const adj = Math.min(running, (testable[i]!.pValue * m) / (i + 1));
    running = adj;
    testable[i]!.adjustedPValue = Math.min(1, adj);
  }
  for (const s of testable) {
    s.significant = s.adjustedPValue <= alpha;
    s.reason = s.significant
      ? `seen in ${s.projectCount} projects; adjusted p=${s.adjustedPValue.toExponential(2)}`
      : `not above the background rate (adjusted p=${s.adjustedPValue.toFixed(3)})`;
  }

  return stats.sort((a, b) => b.score - a.score || b.projectCount - a.projectCount);
}
