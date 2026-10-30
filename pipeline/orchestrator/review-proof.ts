// Proof for review findings (2026-10-30, team plan stage 5). The review loop was the main engine of a build (about 80% of
// the spend): findings arrived as text, a model judged each one against the code, and every round brought new ones.
// Now a finding reaches a builder only with proof:
//   - a finding about what the customer asked for (an SC, EP, ANS or ROLES item) carries a reproduction — an acceptance
//     test in the tester's format — and the fixed runner must see it FAIL on the running app;
//   - a finding about the rules every app keeps (SEC, INT, DESIGN) may instead stand on its quoted code (checked when the
//     reviewer submitted it) and the rule it breaks; the Chief AI's check (chief-check.ts) judges those;
//   - the system's own checks (route sweep, sign-in check, colour check …) are proven by code already.
// A finding without proof goes to the notes (<build>/review-notes.jsonl), not to a builder. A reproduced finding becomes
// a permanent acceptance test (AT-R-n), and an example in the adversarial example database (patent claim 4): caught by the
// reviewer that found it, missed by the other two.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { checkAcceptanceTests, readAcceptanceTests, saveAcceptanceTests, type AcceptanceTest, type PlanScope } from "./acceptance-tests.ts";
import type { RunSummary } from "./acceptance-runner.ts";
import { isMachineFinding, isReviewerFailure } from "./chief-check.ts";

export interface ReviewFinding {
  file: string;
  issue: string;
  /** an acceptance test (without id and phase) that fails on the app while the finding is true */
  reproduction?: Record<string, unknown>;
  /** the code the reviewer quoted */
  evidence?: string;
}

/** What the customer asked for: proven by a test that fails on the running app. */
const BEHAVIOUR_ITEM = /^(SC|EP|ANS)\d+$|^ROLES$/;
/** The rules every app keeps and the approved design: may be proven by the quoted code and the rule. */
const CODE_ITEM = /^(SEC|INT)\d+$|^DESIGN$/;

const NOTICE = /review-incomplete|review did not complete/i;

/** The plan item a finding names: its first bracket tag that is an item of the approved plan. */
export function planItemOf(f: ReviewFinding, ids: Set<string>): string | null {
  for (const m of f.issue.matchAll(/\[([A-Za-z]+\d*)\]/g)) {
    const id = m[1]!.toUpperCase();
    if (ids.has(id)) return id;
  }
  return null;
}

export type Classified =
  | { kind: "machine" }
  | { kind: "notice" }
  | { kind: "test"; planItem: string; test: AcceptanceTest }
  | { kind: "code"; planItem: string }
  | { kind: "note"; reason: string };

/** The reproduction as a test of the last phase (everything is built when the review runs). */
function reproductionTest(f: ReviewFinding, planItem: string, scope: PlanScope): AcceptanceTest | null {
  const r = f.reproduction;
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const title = String(o.title ?? "").trim() || f.issue.replace(/^[^\]]*\]\s*/, "").slice(0, 120);
  return { id: "AT-R-0", phase: scope.phaseCount, planItem, title, as: String(o.as ?? "anyone"), kind: o.kind as AcceptanceTest["kind"], steps: (o.steps ?? []) as AcceptanceTest["steps"] };
}

export function classifyFinding(f: ReviewFinding, scope: PlanScope): Classified {
  if (NOTICE.test(f.issue) || isReviewerFailure(f.issue)) return { kind: "notice" };
  if (isMachineFinding(f.issue)) return { kind: "machine" };
  const planItem = planItemOf(f, scope.itemIds);
  if (!planItem) return { kind: "note", reason: "names no item of the approved plan" };
  const codeOk = CODE_ITEM.test(planItem) && Boolean(f.file);
  const test = reproductionTest(f, planItem, scope);
  if (test) {
    const checked = checkAcceptanceTests([test], "", scope);
    if (checked.accepted.length) return { kind: "test", planItem, test: checked.accepted[0]! };
    if (codeOk) return { kind: "code", planItem };
    return { kind: "note", reason: `its reproduction was refused: ${checked.rejected[0]!.reasons.join("; ")}` };
  }
  if (codeOk) return { kind: "code", planItem };
  if (BEHAVIOUR_ITEM.test(planItem)) return { kind: "note", reason: `a finding about what the customer asked for (${planItem}) needs a reproduction test that fails on the running app` };
  return { kind: "note", reason: `a finding about ${planItem} needs a reproduction test, or a quoted line in a file` };
}

export interface ProvenFindings {
  machine: ReviewFinding[];
  notices: ReviewFinding[];
  /** reproduced: the test failed on the running app */
  confirmedTests: Array<{ finding: ReviewFinding; test: AcceptanceTest; detail: string }>;
  /** to the Chief AI's check: quoted code and the rule it breaks */
  code: Array<{ finding: ReviewFinding; planItem: string }>;
  notes: Array<{ finding: ReviewFinding; reason: string }>;
}

export async function proveReviewFindings(
  findings: ReviewFinding[],
  scope: PlanScope | string,
  deps: { reproduce(tests: AcceptanceTest[]): Promise<RunSummary> },
): Promise<ProvenFindings> {
  const s = typeof scope === "string" ? (await import("./acceptance-tests.ts")).planScope(scope) : scope;
  const out: ProvenFindings = { machine: [], notices: [], confirmedTests: [], code: [], notes: [] };
  const toRun: Array<{ finding: ReviewFinding; test: AcceptanceTest; planItem: string }> = [];
  for (const f of findings) {
    const c = classifyFinding(f, s);
    if (c.kind === "machine") out.machine.push(f);
    else if (c.kind === "notice") out.notices.push(f);
    else if (c.kind === "code") out.code.push({ finding: f, planItem: c.planItem });
    else if (c.kind === "note") out.notes.push({ finding: f, reason: c.reason });
    else toRun.push({ finding: f, test: { ...c.test, id: `AT-R-check-${toRun.length + 1}` }, planItem: c.planItem });
  }
  if (toRun.length === 0) return out;
  const run = await deps.reproduce(toRun.map((t) => t.test));
  toRun.forEach((t, i) => {
    const r = run.results[i];
    if (r?.status === "failed") out.confirmedTests.push({ finding: t.finding, test: t.test, detail: r.detail });
    else if (r?.status === "passed") out.notes.push({ finding: t.finding, reason: "not reproduced: its reproduction passes on the running app" });
    else if (CODE_ITEM.test(t.planItem) && t.finding.file) out.code.push({ finding: t.finding, planItem: t.planItem });
    else out.notes.push({ finding: t.finding, reason: `its reproduction could not be run: ${r?.detail ?? "no result"}` });
  });
  return out;
}

/** Reproduced findings become permanent acceptance tests, numbered AT-R-1, AT-R-2 … across the build. */
export function adoptReviewTests(projectDir: string, tests: AcceptanceTest[]): AcceptanceTest[] {
  const suite = readAcceptanceTests(projectDir) ?? { writtenAt: new Date().toISOString(), tests: [], rejected: [], notWritten: [] };
  let n = suite.tests.filter((t) => /^AT-R-\d+$/.test(t.id)).length;
  const added = tests.map((t) => ({ ...t, id: `AT-R-${++n}`, source: "review" as const }));
  suite.tests.push(...added);
  saveAcceptanceTests(projectDir, suite);
  return added;
}

export function recordReviewNotes(projectDir: string, notes: Array<{ finding: ReviewFinding; reason: string }>): void {
  const at = new Date().toISOString();
  for (const n of notes) appendFileSync(join(projectDir, "review-notes.jsonl"), JSON.stringify({ file: n.finding.file, issue: n.finding.issue, reason: n.reason, at }) + "\n");
}

const REVIEWERS = ["navya", "karan", "deepika"] as const;

/** The reviewer that wrote a finding, from its category tag. */
export function reviewerOf(issue: string): (typeof REVIEWERS)[number] | null {
  if (/\[security\//i.test(issue)) return "karan";
  if (/\[logic\//i.test(issue)) return "navya";
  if (/\[performance\//i.test(issue)) return "deepika";
  return null;
}

export interface ExampleSink {
  bumpExample(checker: string, d: { id: string; operator: string; level: 1 | 2 | 3 | 4 | 5; file: string; description: string; before: string; after: string; hint: string }, caught: boolean): Promise<void>;
}

/** Claim 4: each confirmed finding is an example the reviewer that found it caught and the other two missed. Never fatal. */
export async function recordReviewExamples(
  projectId: string,
  confirmed: Array<{ finding: ReviewFinding; planItem: string; evidence?: string }>,
  store?: ExampleSink,
): Promise<void> {
  try {
    const sink = store ?? ((await import("@nexsidi/db")).createTrainingStore() as unknown as ExampleSink);
    for (const c of confirmed) {
      const finder = reviewerOf(c.finding.issue);
      if (!finder) continue;
      const id = `review:${projectId}:${c.finding.file}:${c.finding.issue.match(/:(\d+)\b/)?.[1] ?? "0"}:${c.planItem}`.slice(0, 200);
      const defect = { id, operator: "review-finding", level: 3 as const, file: c.finding.file, description: c.finding.issue.slice(0, 2_000), before: c.evidence ?? c.finding.evidence ?? "", after: "", hint: `breaks ${c.planItem}` };
      for (const checker of [finder, ...REVIEWERS.filter((r) => r !== finder)]) {
        await Promise.race([
          sink.bumpExample(checker, defect, checker === finder),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), 3_000).unref?.()),
        ]);
      }
    }
  } catch (err) {
    console.warn(`[review-proof] the confirmed findings could not be added to the example database: ${String(err).slice(0, 160)}`);
  }
}
