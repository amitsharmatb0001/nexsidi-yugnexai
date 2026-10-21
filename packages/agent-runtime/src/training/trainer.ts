// Training the checkers against planted defects (patent claim 4), as a loop with two sides.
//
// The generating side is the defect planter (mutations.ts): it puts known defects into copies of real generated code. The
// judging side is a checker (a review agent, or any function from files to findings). A round plants defects at the current
// level, runs the checker on the changed copies and on the unchanged files, and counts a defect as caught only if the checker
// reported something new, on or near the planted line or about it. What the checker missed is kept in the adversarial example
// database; a curriculum (curriculum.ts) raises the difficulty as the checker improves; and the missed examples are written
// back into the checker's prompt, so the next review is told what it failed to see before.
//
// This is the software form of the idea: an adversarial loop with a store of the opponent's successes and a difficulty ramp.
// No model weights are trained here. Whether that matches the filed wording ("GAN-based training") is for the lawyer.
import { createHash } from "node:crypto";
import { MUTATIONS, plantDefect, type Level, type PlantedDefect } from "./mutations.ts";
import type { RoundResult } from "./curriculum.ts";

export interface TrainingFile {
  path: string;
  source: string;
}
export interface TrainingFinding {
  file: string;
  line?: number;
  issue: string;
}
export type Checker = (files: TrainingFile[]) => Promise<TrainingFinding[]>;

export interface TrainingRoundResult {
  checkerName: string;
  level: Level;
  planted: PlantedDefect[];
  caught: PlantedDefect[];
  missed: PlantedDefect[];
  baselineFindings: number;
  newFindings: number;
  /** New findings that match no planted defect: real problems the checker found, or false alarms. */
  unexplainedFindings: number;
  catchRate: number;
  note?: string;
}

const sameFile = (a: string, b: string) => {
  const x = a.split("\\").join("/");
  const y = b.split("\\").join("/");
  return x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`);
};

const LINE_WINDOW = 3;

/** A finding is about a planted defect if it is in the same file and either within 3 lines of it or uses the words for it. */
export function isCaught(defect: PlantedDefect, findings: TrainingFinding[]): boolean {
  const hint = new RegExp(defect.hint, "i");
  return findings.some((f) => sameFile(f.file, defect.file) && ((f.line !== undefined && Math.abs(f.line - defect.line) <= LINE_WINDOW) || hint.test(f.issue)));
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const norm = (f: TrainingFinding) => `${f.file.split("\\").join("/")}|${f.issue.trim().toLowerCase()}`;

export async function runTrainingRound(opts: {
  checker: Checker;
  checkerName: string;
  files: TrainingFile[];
  level: Level;
  /** How many defects to plant (at most one per file). Default 5. */
  count?: number;
  seed?: string;
  /** Findings on the unchanged files, when already known (saves a run of a checker that costs money). */
  baseline?: TrainingFinding[];
}): Promise<TrainingRoundResult> {
  const count = opts.count ?? 5;
  const seed = opts.seed ?? "round";
  const mutations = MUTATIONS.filter((m) => m.level === opts.level);

  // At most one defect per file, so that each can be judged on its own; the choice is fixed by the seed.
  const picks: Array<{ file: TrainingFile; source: string; defect: PlantedDefect }> = [];
  for (const file of opts.files) {
    const options = mutations
      .map((m) => ({ m, planted: plantDefect(file.path, file.source, m) }))
      .filter((x): x is { m: (typeof mutations)[number]; planted: NonNullable<ReturnType<typeof plantDefect>> } => x.planted !== null)
      .sort((a, b) => hash(`${seed}|${file.path}|${a.m.operator}`).localeCompare(hash(`${seed}|${file.path}|${b.m.operator}`)));
    if (options[0]) picks.push({ file, source: options[0].planted.source, defect: options[0].planted.defect });
  }
  const chosen = picks.sort((a, b) => hash(`${seed}|${a.file.path}`).localeCompare(hash(`${seed}|${b.file.path}`))).slice(0, count);

  const empty: TrainingRoundResult = { checkerName: opts.checkerName, level: opts.level, planted: [], caught: [], missed: [], baselineFindings: 0, newFindings: 0, unexplainedFindings: 0, catchRate: 0 };
  if (chosen.length === 0) return { ...empty, note: `no file in this set can take a level ${opts.level} defect` };

  const changed = new Map(chosen.map((c) => [c.file.path, c.source]));
  const mutatedFiles = opts.files.map((f) => ({ path: f.path, source: changed.get(f.path) ?? f.source }));
  const baseline = opts.baseline ?? (await opts.checker(opts.files));
  const baselineKeys = new Set(baseline.map(norm));
  const after = await opts.checker(mutatedFiles);
  const fresh = after.filter((f) => !baselineKeys.has(norm(f)));

  const planted = chosen.map((c) => c.defect);
  const caught = planted.filter((d) => isCaught(d, fresh));
  const caughtIds = new Set(caught.map((d) => d.id));
  const missed = planted.filter((d) => !caughtIds.has(d.id));
  const unexplained = fresh.filter((f) => !planted.some((d) => isCaught(d, [f]))).length;
  return {
    checkerName: opts.checkerName, level: opts.level, planted, caught, missed,
    baselineFindings: baseline.length, newFindings: fresh.length, unexplainedFindings: unexplained,
    catchRate: planted.length === 0 ? 0 : caught.length / planted.length,
  };
}

// ── the adversarial example database ────────────────────────────────────────

export interface AdversarialExample {
  checker: string;
  id: string;
  operator: string;
  level: Level;
  file: string;
  description: string;
  before: string;
  after: string;
  hint: string;
  caught: number;
  missed: number;
}

export interface ExampleStore {
  addRound(checker: string, level: Level, planted: number, caught: number): Promise<void>;
  bumpExample(checker: string, defect: PlantedDefect, caught: boolean): Promise<void>;
  /** Examples the checker has missed, hardest-missed first, at or below `maxLevel`. */
  missedFor(checker: string, maxLevel: number, limit: number): Promise<AdversarialExample[]>;
  history(checker: string): Promise<RoundResult[]>;
}

export async function recordRound(store: ExampleStore, r: TrainingRoundResult): Promise<void> {
  if (r.planted.length === 0) return;
  await store.addRound(r.checkerName, r.level, r.planted.length, r.caught.length);
  for (const d of r.missed) await store.bumpExample(r.checkerName, d, false);
  for (const d of r.caught) await store.bumpExample(r.checkerName, d, true);
}

export function memoryStore(): ExampleStore {
  const examples = new Map<string, AdversarialExample>();
  const rounds: Array<{ checker: string } & RoundResult> = [];
  return {
    addRound: async (checker, level, planted, caught) => void rounds.push({ checker, level, planted, caught }),
    bumpExample: async (checker, d, caught) => {
      const key = `${checker}|${d.id}`;
      const e = examples.get(key) ?? { checker, id: d.id, operator: d.operator, level: d.level, file: d.file, description: d.description, before: d.before, after: d.after, hint: d.hint, caught: 0, missed: 0 };
      if (caught) e.caught++;
      else e.missed++;
      examples.set(key, e);
    },
    missedFor: async (checker, maxLevel, limit) =>
      [...examples.values()]
        .filter((e) => e.checker === checker && e.missed > 0 && e.level <= maxLevel)
        .sort((a, b) => b.missed - b.caught - (a.missed - a.caught) || b.level - a.level)
        .slice(0, limit),
    history: async (checker) => rounds.filter((r) => r.checker === checker).map(({ level, planted, caught }) => ({ level, planted, caught })),
  };
}

/** The block written into a checker's prompt: what checkers like it have missed before. "" when there is nothing. */
export function formatMissedForPrompt(examples: AdversarialExample[], limit = 5): string {
  if (examples.length === 0) return "";
  const lines = examples.slice(0, limit).map((e) => {
    const snippet = e.before ? ` Example: \`${e.before.slice(0, 100)}\`${e.after ? ` became \`${e.after.slice(0, 100)}\`` : " was removed"}.` : ` Example: \`${e.after.slice(0, 100)}\`.`;
    return `- [${e.operator}, level ${e.level}, missed ${e.missed} time(s)] ${e.description}${snippet}`;
  });
  return `Defects that reviewers like you have missed before (planted in test runs and not reported). Look specifically for problems of these kinds:\n${lines.join("\n")}`;
}
