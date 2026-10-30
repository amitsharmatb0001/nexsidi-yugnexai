// The reviewers run once (2026-10-30, team plan stage 5). The review loop (stage5-qa-fix-loop.ts) was the main engine of a
// build: review, fix, review again, until the findings ran out — about 80% of the spend, and each round brought new
// findings in files nobody had touched. Now, on a build whose acceptance tests already pass:
//   1. the three reviewers review all the code once;
//   2. each finding needs proof (../review-proof.ts): a reproduction test that fails on the running app, or — for the rules
//      every app keeps — its quoted code, which the Chief AI's check judges; one without proof goes to the notes;
//   3. a reproduced finding becomes a permanent acceptance test (and a claim-4 example); the system's own checks and the
//      confirmed code findings get one fix run by their owner (disputes go to the Chief AI);
//   4. the acceptance gate runs every test, the review's new ones included, and fixes until they pass — a fix is done when
//      its test passes. There is no second review round.
// What is still open at the end (a test that still fails, a fix run that could not finish) holds the build for a person.
import type { BuildPlan } from "../../../agents/arjun/src/index.ts";
import { groupFindingsByAgent, type Finding, type Stage4Result } from "./stage4-multi-agent-dev.ts";
import type { Stage5Result } from "./stage5-adversarial-qa.ts";
import { applyEvidenceGate, gateQaFindings, type QAFixDeps, type QAFixLoopResult } from "./stage5-qa-fix-loop.ts";
import { adoptReviewTests, planItemOf, proveReviewFindings, recordReviewNotes, type ReviewFinding } from "../review-proof.ts";
import { planScope, type AcceptanceTest } from "../acceptance-tests.ts";
import type { RunSummary } from "../acceptance-runner.ts";
import { dropSettledNotTrue, resolveDisputes } from "../disputes.ts";
import { isReviewerFailure } from "../chief-check.ts";
import { buildDirFor } from "../../../packages/agent-runtime/src/build-dir.ts";
import type { Escalation } from "../../../packages/agent-runtime/src/tools/escalate.ts";

export interface ReviewOnceDeps extends Pick<QAFixDeps, "fixShubham" | "fixAanya" | "fixPranav" | "settleDisputes" | "chiefChat" | "openQuestions" | "recordInstincts"> {
  runStage5(projectId: string, stage4Result: Stage4Result, plan?: BuildPlan): Promise<Stage5Result>;
  /** runs reproduction tests on the running app, results in the same order */
  reproduce(tests: AcceptanceTest[]): Promise<RunSummary>;
  /** the acceptance gate over every test (orchestrator/acceptance-gate.ts) */
  gate(): Promise<{ status: "passed" | "failing" | "not_checked" | "waiting_for_customer"; reason?: string; failing?: string[] }>;
  /** claim 4: confirmed findings into the adversarial example database */
  recordExamples?(confirmed: Array<{ finding: ReviewFinding; planItem: string; evidence?: string }>): Promise<void>;
}

const REVIEW_RERUNS = 2;
const isNotice = (f: Finding) => /review-incomplete|review did not complete/i.test(f.issue) || isReviewerFailure(f.issue);
const formatFinding = (f: { file: string; issue: string }) => (f.file ? `${f.file}: ${f.issue}` : f.issue);

/** One fix run per owner for the findings that are not tests; returns the findings whose owner could not finish. */
async function fixOnce(projectId: string, plan: BuildPlan, findings: Finding[], deps: ReviewOnceDeps): Promise<Finding[]> {
  if (findings.length === 0) return [];
  const roundStart = new Date().toISOString();
  const groups = groupFindingsByAgent(findings);
  type Owner = "shubham" | "aanya" | "pranav";
  const fixerOf = (o: Owner) => (o === "shubham" ? deps.fixShubham : o === "aanya" ? deps.fixAanya : deps.fixPranav);
  const outcomes = await Promise.all(
    [...groups.entries()].map(async ([owner, list]) => {
      const fix = fixerOf(owner as Owner);
      const texts = list.map(formatFinding);
      if (!fix) return { owner, list, success: false, escalations: [] as Escalation[] };
      await deps.recordInstincts?.(owner, texts);
      const r = await fix(plan, texts);
      return { owner, list, success: r.success, escalations: r.escalations ?? [] };
    }),
  );
  // A finding handed to another owner is fixed by that owner in the same run (once).
  for (const target of ["shubham", "aanya", "pranav"] as const) {
    const handed = outcomes.flatMap((o) => o.escalations).filter((e) => e.targetAgent === target);
    const fix = fixerOf(target);
    if (handed.length && fix) await fix(plan, handed.map((e) => `${e.finding} — ${e.reason}`));
  }
  await resolveDisputes(projectId, roundStart, plan, { settle: deps.settleDisputes, fixers: { shubham: deps.fixShubham, aanya: deps.fixAanya, pranav: deps.fixPranav } });
  // A finding the Chief AI ruled not true on a dispute is settled; the rest of an unfinished fix run's findings stay open.
  const open = outcomes.filter((o) => !o.success).flatMap((o) => o.list);
  return dropSettledNotTrue(projectId, open).kept;
}

export async function runReviewOnceWithDeps(projectId: string, plan: BuildPlan, stage4Result: Stage4Result, deps: ReviewOnceDeps): Promise<QAFixLoopResult> {
  const dir = buildDirFor(projectId);
  let review = applyEvidenceGate(await deps.runStage5(projectId, stage4Result, plan), projectId);
  // A review that did not complete is not a pass: run it again, twice at most.
  for (let n = 0; n < REVIEW_RERUNS && review.findings.length > 0 && review.findings.every(isNotice); n++) {
    console.log(`[review-once] a reviewer did not finish — running the review again (${n + 1} of ${REVIEW_RERUNS})`);
    review = applyEvidenceGate(await deps.runStage5(projectId, stage4Result, plan), projectId);
  }
  if (review.findings.length > 0 && review.findings.every(isNotice)) {
    return { ...review, pass: false, iterations: 1, stuck: true, hold: { reason: "the review did not complete, even when run again", evidence: review.findings.map(formatFinding) } };
  }

  const scope = planScope(dir);
  const proven = await proveReviewFindings(review.findings.filter((f) => !isNotice(f)), scope, { reproduce: deps.reproduce });
  recordReviewNotes(dir, proven.notes);
  const added = adoptReviewTests(dir, proven.confirmedTests.map((c) => c.test));
  // The rules every app keeps, proven by quoted code: the Chief AI's check decides (fix, later, or not true).
  const checked = proven.code.length ? await gateQaFindings(projectId, { pass: false, findings: proven.code.map((c) => c.finding) }, deps.chiefChat) : { findings: [] as Finding[] };
  const confirmedCode = checked.findings.filter((f) => !isNotice(f));
  await deps.recordExamples?.([
    ...proven.confirmedTests.map((c) => ({ finding: c.finding, planItem: c.test.planItem, ...(c.finding.evidence ? { evidence: c.finding.evidence } : {}) })),
    ...confirmedCode.map((f) => ({ finding: f as ReviewFinding, planItem: planItemOf(f, scope.itemIds) ?? "", ...(f.evidence ? { evidence: f.evidence } : {}) })),
  ]);
  console.log(
    `[review-once] ${review.findings.length} finding(s): ${added.length} reproduced (now tests ${added.map((t) => t.id).join(", ") || "-"}), ` +
      `${confirmedCode.length} confirmed in the code, ${proven.machine.length} from the system's checks, ${proven.notes.length} to the notes`,
  );

  const unfixed = await fixOnce(projectId, plan, [...proven.machine, ...confirmedCode], deps);
  if ((deps.openQuestions?.() ?? 0) > 0) {
    console.log(`[review-once] a builder asked the customer a question — the step stops until it is answered`);
    return { ...review, pass: false, iterations: 1, stuck: false };
  }

  // Every test, the review's new ones included: a fix is done when its test passes.
  const gate = await deps.gate();
  if (gate.status === "waiting_for_customer") return { ...review, pass: false, iterations: 1, stuck: false };
  const failing = gate.status === "failing" ? (gate.failing ?? []) : [];
  if (failing.length > 0 || gate.status === "failing" || unfixed.length > 0) {
    const reasons = [
      ...(gate.status === "failing" ? [`acceptance tests still fail: ${gate.reason ?? ""}`.trim()] : []),
      ...(unfixed.length ? [`${unfixed.length} confirmed finding(s) not fixed: their fix run could not finish`] : []),
    ];
    return {
      ...review,
      findings: unfixed,
      pass: false,
      iterations: 1,
      stuck: true,
      hold: { reason: reasons.join("; "), evidence: [...failing, ...unfixed.map(formatFinding)] },
    };
  }
  return { ...review, findings: [], pass: true, iterations: 1, stuck: false };
}
