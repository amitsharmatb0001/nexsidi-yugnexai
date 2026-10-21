// A checker that needs no model: the pattern scan, the taint analysis, the leak patterns and the growth estimate, run over
// a set of files and reported as findings. It is the "opponent" for training rounds that cost nothing, and a baseline the
// review agents' scores can be compared with.
import { scanSource, SEED_PATTERNS } from "../security/pattern-scan.ts";
import { analyzeTaint } from "../security/taint.ts";
import { findLeakPatterns } from "../performance/leaks.ts";
import { analyzeComplexity } from "../performance/complexity.ts";
import type { Checker, TrainingFile, TrainingFinding } from "./trainer.ts";

export const staticChecker: Checker = async (files: TrainingFile[]): Promise<TrainingFinding[]> => {
  const out: TrainingFinding[] = [];
  for (const f of files) {
    for (const h of scanSource(f.path, f.source, SEED_PATTERNS)) out.push({ file: f.path, line: h.line, issue: `${h.key}: ${h.evidence}` });
    for (const t of analyzeTaint(f.path, f.source)) out.push({ file: f.path, line: t.sink.line, issue: t.message });
    for (const l of findLeakPatterns(f.path, f.source)) out.push({ file: f.path, line: l.line, issue: l.message });
    for (const c of analyzeComplexity(f.path, f.source, { onlyConcerns: true })) out.push({ file: f.path, line: c.line, issue: `${c.estimate} ${c.name}: ${c.reasons.join("; ")}` });
  }
  return out;
};
