// Stage 6 — Deployment: wraps Riya with the deployTarget flag, then re-runs
// Stage 5's adversarial QA against the LIVE deployed URL. This is the "live
// retest" the design doc calls out explicitly — it is what would have caught
// Sprint 1's CORS-origin-mismatch and unmounted-routes bugs immediately,
// since those were deploy-config issues invisible before containers were
// actually running (see design doc, Stage 6 section).
//
// ── Stage 5 live-retest status ──────────────────────────────────────────────
// stage5-adversarial-qa.ts now exists and exports `runStage5(projectId,
// stage4Result): Promise<Stage5Result>`. runStage6()'s default `deps` below
// wraps it via a real dynamic import (`runRealLiveRetest`) — the same
// `await import(...)` pattern stage4-multi-agent-dev.ts uses for its agent
// calls. `runLiveRetestStub` is kept (exported) purely as an opt-in stub for
// callers/tests that want to bypass a real QA re-run — it is no longer the
// default and MUST NOT be reintroduced as the default without a comment
// explaining why real QA coverage is being turned off again.
import { isOverBudget } from "../../../packages/agent-runtime/src/cost-budget.ts";
import { resolveFlags } from "../flags.ts";
import { run as runRiya, purgeVerificationArtifacts, seedSampleData, limitedRolesFromContract, grantTestAccountRole, snapshotTableCounts, compareSnapshots, databaseNow, recordSeededRecords, type DeployResult } from "../../../agents/riya/src/index.ts";
import { readAcceptanceTests } from "../acceptance-tests.ts";
import { runAcceptanceTests, recordAcceptanceRun, type RunnerAccount } from "../acceptance-runner.ts";
import { agentForFile, type Stage4Result } from "./stage4-multi-agent-dev.ts";
import type { Stage5Result } from "./stage5-adversarial-qa.ts";
import type { Finding } from "./stage4-multi-agent-dev.ts";
import type { BuildPlan } from "../../../agents/arjun/src/index.ts";
import type { Escalation } from "../../../packages/agent-runtime/src/tools/escalate.ts";
// 2026-07-24 (P2, full agentic upgrade): System B — the subjective live
// evaluator CLAUDE.md documents (design/originality/craft/functionality,
// pass >=7.0). Did not exist before this: runLiveTest (pipeline/activities/
// index.ts) was a hardcoded `return 8.0` stub, zero callers. Wired in here,
// not in Stage 5, because System B needs a real deployed URL to browse —
// the same reason Tier 3 only legitimately runs post-deploy (see
// runRealLiveRetest below).
import { runLiveEval, LIVE_PASS_THRESHOLD, type LiveEvalResult } from "../../../agents/tilotma/src/live-eval.ts";
// 2026-08-05: a cheap, mechanical check for literal spec violations that
// neither System A (bug hunting) nor System B (holistic design judgment) can
// catch — see spec-compliance.ts's header comment for the exact live bug
// (correct colors in generated source, wrong colors in the live render) that
// motivated this. Runs regardless of System B's pass/fail — it is an
// independent, mandatory gate, not a fallback for it.
import { runSpecComplianceCheck, runStackConformanceCheck, toFindings, type SpecComplianceResult } from "./spec-compliance.ts";
import type { ProjectSpec } from "../../../agents/saanvi/src/index.ts";
// 2026-08-05: shared home (pipeline/activities/index.ts's generator
// activities need the identical check for the same reason) — re-exported
// here for backward compat with this file's own tests/callers.
import { isQuotaExhaustionError } from "../../../packages/agent-runtime/src/gemini-loop.ts";
import { dropCodeContradictedFindings } from "../finding-evidence.ts";
import { fixChangedCode } from "./stage5-qa-fix-loop.ts";
import { dropSettledNotTrue, resolveDisputes, type SettleFn } from "../disputes.ts";
import { dropOutOfScopeFindings } from "../out-of-scope.ts";
import { runFixAsTeam } from "../team-fix.ts";
import { chiefCheck, defaultChiefChat, isMachineFinding, isReviewerFailure, prepareForChief, type ChiefChat } from "../chief-check.ts";
import { checkRoundGuard, type GuardVerdict } from "../progress-guard.ts";
import { runAuthSmokeTest } from "./auth-smoke.ts";
import { runRouteSweepReal, createReviewAccount } from "./route-sweep.ts";
import { join as joinPath, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { reviewDbUrl } from "../../../packages/agent-runtime/src/tools/compose-ports.ts";
import { resetAppRateLimits } from "./limiter-reset.ts";
import { buildDirFor } from "../../../packages/agent-runtime/src/build-dir.ts";
import { liveBudgetMs, minutesSince } from "../time-budget.ts";
import { projectHygieneFindings, dedupeAgainstHygiene } from "./shipping-hygiene.ts";
import { openCustomerQuestions } from "../../../packages/agent-runtime/src/tools/ask.ts";
export { isQuotaExhaustionError };

// Confidentiality Global Constraint (plan + CLAUDE.md): internal agent names
// never appear in anything that could be user-facing. buildDeliverySummary()
// below is the one thing in this stage that produces user-facing output, and
// its own test (stage6-deployment.test.ts) asserts none of these names ever
// appear in what it returns.
const INTERNAL_AGENT_NAMES = [
  "tilotma",
  "saanvi",
  "arjun",
  "vanya",
  "aanya",
  "shubham",
  "pranav",
  "riya",
  "navya",
  "karan",
  "deepika",
] as const;

// 2026-09-28: findings whose claim the project's real source disproves (see
// finding-evidence.ts) are dropped before routing — the live stage has no
// debate, so a false CRITICAL (project a034f90ba50e) went straight to a fixer.
// If that leaves no findings and nothing else failed, the retest passes.
// 2026-10-25: the file-read hygiene checks (shipping-hygiene.ts) on the finished project join the live review as proven machine findings, so a
// build whose builders missed them still gets them fixed, by the owner of each file, in the same round. Never fatal.
export function withHygieneFindings(projectId: string, retest: LiveRetestResult): LiveRetestResult {
  let found: Array<{ file: string; issue: string }> = [];
  try {
    found = projectHygieneFindings(buildDirFor(projectId));
  } catch (err) {
    console.error(`[stage6] hygiene checks skipped: ${String(err).slice(0, 160)}`);
  }
  if (found.length === 0) return retest;
  const existing = Array.isArray(retest.findings) ? (retest.findings as Array<{ file?: string; issue?: string; detail?: string }>) : [];
  // A reviewer's restatement of a hygiene finding is dropped: it is proven by code and already goes to the owner of the file.
  const { kept, dropped } = dedupeAgainstHygiene(found, existing);
  console.log(`[stage6] ${found.length} hygiene finding(s) from the project files join the live review${dropped.length > 0 ? ` (${dropped.length} reviewer finding(s) that restate them are dropped)` : ""}`);
  return { ...retest, findings: [...found, ...kept], pass: false };
}

export function guardLiveRetest(projectId: string, retest: LiveRetestResult): LiveRetestResult {
  if (retest.pass || !Array.isArray(retest.findings) || retest.findings.length === 0) return retest;
  const projectDir = buildDirFor(projectId);
  const code = dropCodeContradictedFindings(retest.findings as Array<{ file: string; issue?: string; detail?: string }>, projectDir);
  for (const d of code.dropped) console.log(`[stage6] dropped finding contradicted by the code (${d.reason}): ${d.finding.file}`);
  // 2026-10-03 (evidence-only plan): findings Tilotma ruled not true after a
  // builder's dispute (../disputes.ts) are dropped too.
  const settled = dropSettledNotTrue(projectId, code.kept);
  for (const d of settled.dropped) console.log(`[stage6] dropped finding Tilotma ruled not true: ${d.file}: ${String(d.issue ?? d.detail ?? "").slice(0, 120)}`);
  // 2026-10-22: a request for an endpoint nobody asked for (not in the approved contract, not called by any page) is not a
  // defect; on the Trailhead rerun two of these cost whole rounds before being settled not true (../out-of-scope.ts).
  const scope = dropOutOfScopeFindings(settled.kept, projectDir);
  for (const d of scope.dropped) console.log(`[stage6] dropped out-of-scope finding (${d.reason}): ${String(d.finding.issue ?? d.finding.detail ?? "").slice(0, 120)}`);
  const kept = scope.kept;
  if (code.dropped.length + settled.dropped.length + scope.dropped.length === 0) return retest;
  // The spec check's own verdict stands only while one of its findings remains.
  const specOpen = kept.some((f) => String(f.issue ?? f.detail ?? "").includes("[spec-compliance]"));
  const specCompliance = retest.specCompliance && !retest.specCompliance.pass && !specOpen
    ? { ...retest.specCompliance, pass: true, violations: [] }
    : retest.specCompliance;
  const othersPass = retest.liveEval?.pass !== false && specCompliance?.pass !== false;
  return { ...retest, findings: kept, specCompliance, pass: kept.length === 0 && othersPass };
}

// 2026-10-24 (docs/root-cause/2026-10-24-brewline.md): after the checks above, before anything is fixed.
//   - A reviewer's own failure (a timeout, a crash) is not an app finding: it is taken out and the review is run again
//     (Brewline rounds 6 and 7 sent "Navya's review did not complete" to the frontend builder twice).
//   - Machine findings (page sweep, colour check, sign-in check, ...) are proven by code and pass unchanged.
//   - Model-written findings go through the proof gate and the Chief AI's one call (../chief-check.ts); only those it
//     confirms against the approved plan and the real code are fixed, restated with the real code.
export async function gateLiveFindings(projectId: string, retest: LiveRetestResult, chat: ChiefChat | null | undefined): Promise<LiveRetestResult> {
  if (retest.pass || !Array.isArray(retest.findings) || retest.findings.length === 0) return retest;
  type F = { file?: string; issue?: string; detail?: string };
  const all = retest.findings as F[];
  const textOf = (f: F) => String(f.issue ?? f.detail ?? "");
  const failures = all.filter((f) => isReviewerFailure(textOf(f)));
  const machine = all.filter((f) => !isReviewerFailure(textOf(f)) && isMachineFinding(textOf(f)));
  let model = all.filter((f) => !isReviewerFailure(textOf(f)) && !isMachineFinding(textOf(f)));
  if (chat && model.length > 0) {
    const projectDir = buildDirFor(projectId);
    const prepared = prepareForChief(projectDir, model.map((f) => (f.file ? `\`${f.file}\` ${textOf(f)}` : textOf(f))));
    const result = await chiefCheck(projectDir, prepared, chat);
    model = result.fix.map((x) => {
      const original = model[prepared.findIndex((p) => p.text === x.original)] ?? {};
      return { ...original, issue: x.text };
    });
    console.log(`[stage6] Chief AI check: ${result.fix.length} to fix, ${result.later.length} outside the plan (kept for later), ${result.notTrue.length} not true${result.checked ? "" : " (check failed — all kept)"}`);
  }
  for (const f of failures) console.log(`[stage6] a reviewer did not finish — not an app finding, the review runs again: ${textOf(f).slice(0, 160)}`);
  const kept = [...machine, ...model];
  const othersPass = retest.liveEval?.pass !== false && retest.specCompliance?.pass !== false;
  const notChecked = [...(retest.notChecked ?? []), ...failures.map((f) => `review did not finish: ${textOf(f).slice(0, 200)}`)];
  return {
    ...retest,
    findings: kept,
    notChecked,
    reviewIncomplete: failures.length > 0 && kept.length === 0,
    pass: kept.length === 0 && failures.length === 0 && othersPass,
  };
}

export interface LiveRetestResult {
  pass: boolean;
  findings: unknown;
  // 2026-07-24 (P2): System B result, when it ran. Optional so existing
  // callers/tests that construct a LiveRetestResult without it (deploy-only
  // stubs, unit tests exercising deploy logic in isolation) are unaffected —
  // buildDeliverySummary only gates on it when present.
  liveEval?: LiveEvalResult;
  // 2026-08-05: literal spec-compliance result, when it ran. Same optionality
  // convention as liveEval above — independent of it, not derived from it.
  specCompliance?: SpecComplianceResult;
  // 2026-10-03 (evidence-only plan, T3): required checks that could not run,
  // with why. Never routed to a builder; the delivery is not verified.
  notChecked?: string[];
  // 2026-10-24: a reviewer's own failure (timeout, crash) — never an app finding; the review is run again instead.
  reviewIncomplete?: boolean;
  // 2026-10-25 (brewline2): this pass came without the live browser review and the design score (they run only when the static
  // reviewers pass, and the Chief AI set their findings aside afterwards). Stage 6 runs them before accepting the pass.
  needsBrowserReview?: boolean;
}

// 2026-09-29: real bug (project a034f90ba50e). A failed live design review
// (5.95 against a 7.0 pass mark) never became a finding, so the fix loop only
// ever routed the other checks' output and no fixer saw the design critique:
// every fix round changed nothing. The critique goes to the frontend as one
// site-wide finding ({ file: "" } routes to Aanya — see splitLiveFindings).
// Only the reviewer's REASONING is passed on: the evidence list above it is
// tool output, not critique.
export function designFindings(liveEval: LiveEvalResult): Array<{ file: string; issue: string }> {
  if (liveEval.pass) return [];
  // Not scored is not a failing design (2026-10-04): nothing to send a builder.
  if (liveEval.unscored) return [];
  const s = liveEval.scores;
  const perCriterion = s
    ? ` (design ${s.designQuality}, originality ${s.originality}, craft ${s.craft}, functionality ${s.functionality})`
    : "";
  const critique = (liveEval.summary.match(/REASONING:\s*([\s\S]*)$/i)?.[1] ?? liveEval.summary).trim().slice(0, 4000);
  return [{
    file: "",
    issue: `Live design review failed: ${liveEval.score.toFixed(2)}/10 against a pass mark of ${LIVE_PASS_THRESHOLD}${perCriterion}. The reviewer's critique of the running app: ${critique}`,
  }];
}

export interface Stage6Result {
  success: boolean;
  appUrl: string;
  findings?: unknown;
  deliverySummary: DeliverySummary;
  // true when consecutive deploy attempts produced identical errors — the
  // pipeline is stuck and retrying won't help (same pattern as Stage 5).
  stuck?: boolean;
  // 2026-10-04 (progress guard): set when the work was held — see ../progress-guard.ts
  hold?: { reason: string; evidence: string[] };
}

export interface DeliverySummary {
  // "not_verified": a required check could not run (evidence-only plan, T3)
  status: "delivered" | "failed" | "not_verified";
  notChecked?: string[];
  appUrl: string;
  githubRepo: string | null;
}

// Generic-labeled delivery summary — "URL + repo + feature list" per the
// design doc's Confidentiality table. No QA scores, no iteration counts, no
// agent names. Deterministic and unit-tested directly (see
// stage6-deployment.test.ts) rather than only indirectly through runStage6.
export function buildDeliverySummary(
  deployResult: DeployResult,
  retest: LiveRetestResult,
): DeliverySummary {
  // 2026-07-24 (P2): fail-closed on System B too, when it ran — a site that
  // passes every objective check but scores as generic AI slop must not
  // reach "delivered". `liveEval` is optional so callers that never ran it
  // (deploy-only tests/stubs) aren't gated on something that didn't happen.
  const liveEvalOk = retest.liveEval ? retest.liveEval.pass : true;
  // 2026-08-05: same fail-closed convention — a site System B rates as
  // well-designed can still violate a literal spec fact (wrong color,
  // missing form field). Independent of liveEvalOk: neither gate rescues
  // the other.
  const specComplianceOk = retest.specCompliance ? retest.specCompliance.pass : true;
  const passed = deployResult.success && retest.pass && liveEvalOk && specComplianceOk;
  // A pass that never had the live browser review and the design score is not verified (it used to count as delivered).
  const notChecked = [
    ...(retest.notChecked ?? []),
    ...(retest.needsBrowserReview ? ["the live browser review and the design score did not run: the static reviewers' findings were set aside after the point where they are decided"] : []),
  ];
  return {
    status: !passed ? "failed" : notChecked.length > 0 ? "not_verified" : "delivered",
    ...(notChecked.length > 0 ? { notChecked } : {}),
    appUrl: deployResult.appUrl,
    githubRepo: deployResult.githubRepo,
  };
}

// Opt-in stub — kept for callers/tests that deliberately want to bypass a
// real QA re-run (e.g. exercising deploy-only logic without paying for a
// live LLM run). No longer the default; see `runRealLiveRetest` below and
// the file-header comment.
export async function runLiveRetestStub(projectId: string, appUrl: string): Promise<LiveRetestResult> {
  console.warn(
    `[stage6] Stage 5 live-retest STUBBED for project ${projectId} against ${appUrl} — ` +
      `explicitly bypassing real adversarial QA. This is NOT real QA coverage.`,
  );
  return { pass: true, findings: [] };
}

// Real live-retest: re-runs Stage 5's adversarial QA (Navya/Karan/Deepika +
// Tilotma's Tier 3 evidence review) against the SAME Stage 4 output
// directories now that the app is actually deployed and running at `appUrl`.
// Stage 5's real entry point (runStage5) re-reads code straight off disk
// from stage4Result.backendOutputDir/frontendOutputDir — Riya's deploy does
// not write generated code to a different output directory, it deploys what
// Stage 4 already wrote for this projectId (same BUILD_DIR convention every
// stage uses) — so Stage 4's pre-deploy output dirs are still the correct
// ones to re-scan here; there is no separate post-deploy output dir to
// reconcile.
//
// The one part of Stage 5 that genuinely needs the LIVE url is Tilotma's
// Tier 3 evidence collector — it screenshots a running app
// (agents/tilotma/src/tier3-review.ts) and reads its target from
// `process.env.TIER3_REVIEW_URL` (defaulting to localhost:3000 when unset).
// This wrapper points that env var at the just-deployed `appUrl` for the
// duration of the call and restores whatever was there before, so a live
// retest actually reviews the deployed instance rather than whatever
// TIER3_REVIEW_URL happened to be set to.
// Same BUILD_DIR/projectId/<file> + dynamic-import-of-node:fs convention this
// file already uses for qa-submissions.json reads below (instinct-mismatch
// observation blocks). Throws on a missing/unreadable/malformed file —
// callers (runRealLiveRetest) report "not checked", since a broken spec.json
// read is this check's own plumbing failing, not a real spec violation.
async function readProjectSpec(projectId: string): Promise<ProjectSpec> {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const buildDir = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";
  const specPath = join(buildDirFor(projectId, buildDir), "spec.json");
  return JSON.parse(readFileSync(specPath, "utf-8")) as ProjectSpec;
}

// 2026-08-31: extracted so the reordering's actual decision — skip the two
// expensive, browser-driven stages (Stage 5/Tier 3 + live-eval) when either
// mechanical compliance check already failed — is unit-testable without
// mocking runRealLiveRetest's real docker/LLM orchestration (which is
// deliberately NOT exported/tested for that reason; see this file's own
// header comment on stage6-deployment.test.ts's testing philosophy).
export function shouldSkipExpensiveReview(specComplianceOk: boolean, stackConformanceOk: boolean): boolean {
  return !specComplianceOk || !stackConformanceOk;
}

// 2026-09-29 (project a034f90ba50e): tools/db.ts says Stage 6 sets
// TIER3_DB_URL, but nothing did — every live review reported "db_query
// unavailable" as a finding and could not verify that data really landed.
export function reviewDbUrlForBuild(frontendOutputDir: string): string | null {
  const composePath = joinPath(dirname(frontendOutputDir), "docker-compose.yml");
  return existsSync(composePath) ? reviewDbUrl(readFileSync(composePath, "utf-8")) : null;
}

async function runRealLiveRetest(
  projectId: string,
  appUrl: string,
  backendUrl: string,
  stage4Result: Stage4Result,
  plan?: BuildPlan,
  changedFiles?: string[],
  browserReviewOnly = false,
): Promise<LiveRetestResult> {
  const notChecked: string[] = [];
  const buildDir = buildDirFor(projectId);
  // Row counts before any test data exists; compared with the counts after the cleanup below.
  const baseline = snapshotTableCounts(buildDir);
  // The same moment on the database's own clock: rows the testing adds to public form tables (a contact form) are removed
  // by their time, since no account owns them.
  const testingStartedAt = databaseNow(buildDir);
  // 2026-10-25: the app's sign-up/sign-in limiter counts in memory and the checks below use its whole budget; start the round
  // with fresh counters (limiter-reset.ts) so they are not answered with 429.
  const resetBefore = await resetAppRateLimits(buildDir, backendUrl);
  if (!resetBefore.ok) console.warn(`[stage6] could not reset the app's rate limits before the checks: ${resetBefore.reason}`);
  const result = await liveRetestChecks(projectId, appUrl, backendUrl, stage4Result, plan, notChecked, changedFiles, browserReviewOnly);
  // The live review signs up its own test accounts and the route sweep creates sample data under one. With
  // the data-safe redeploy they would stay in the database for good, so they are removed as soon as the
  // review ends (every account on the reserved test domain — see VERIFICATION_EMAIL_PATTERN in riya, which
  // removes everything that points at them too).
  purgeVerificationArtifacts(buildDir, testingStartedAt);
  // ...and hand the app over with fresh counters, so the customer's first sign-up is not refused for the checks' sake.
  const resetAfter = await resetAppRateLimits(buildDir, backendUrl);
  if (!resetAfter.ok) notChecked.push(`the app's sign-up/sign-in limiter could not be reset after the checks (${resetAfter.reason}), so the first sign-ups may be refused for a few minutes`);
  // 2026-10-05 (Amit): "clean" is checked, not assumed — every table must hold no more rows than before.
  const after = snapshotTableCounts(buildDir);
  if (baseline && after) {
    const left = compareSnapshots(baseline, after);
    if (left.length > 0) {
      console.error(`[stage6] TEST DATA LEFT IN THE DATABASE after the cleanup:\n${left.join("\n")}`);
      notChecked.push(`the database is not clean after the testing — ${left.join("; ")}`);
    } else {
      console.log("[stage6] Test data cleanup verified: every table holds no more rows than before the testing");
    }
  } else {
    notChecked.push("the database could not be read, so it was not verified that all test data was removed");
  }
  const all = [...notChecked, ...(result.specCompliance?.notChecked ?? [])];
  if (all.length === 0) return result;
  console.error(`[stage6] not checked:\n${all.join("\n")}`);
  return { ...result, notChecked: all };
}

async function liveRetestChecks(
  projectId: string,
  appUrl: string,
  backendUrl: string,
  stage4Result: Stage4Result,
  // F5 (agent-autonomy-assessment): same systemContext fan-out as the
  // pre-deployment gate (stage5-qa-fix-loop.ts) — the live retest re-runs
  // the SAME Navya/Karan/Deepika and deserves the same spec/contract/schema
  // context, not just the pre-deploy pass.
  plan: BuildPlan | undefined,
  notChecked: string[],
  changedFiles?: string[],
  // 2026-10-25: only the live browser review (Tier 3) and the design score, with the same test accounts and sample data; the
  // checks that already passed in this round are not repeated.
  browserReviewOnly = false,
): Promise<LiveRetestResult> {
  const { runStage5 } = await import("./stage5-adversarial-qa.ts");

  // NOTE: an in-process `chromium.launch()` screenshot used to run here. Removed
  // 2026-07-11 — it ran under Bun (the pipeline runtime), where Playwright hangs
  // (root cause of the whole screenshot saga). Tilotma's Tier 3 review, invoked
  // by runStage5 below, now drives the live app via the Node browser worker
  // (packages/agent-runtime/src/browser) and captures its own screenshots.

  const previousUrl = process.env.TIER3_REVIEW_URL;
  const previousBackendUrl = process.env.TIER3_REVIEW_BACKEND_URL;
  process.env.TIER3_REVIEW_URL = appUrl;
  // 2026-07-11: real bug found live — Tier 3 only ever knew the frontend
  // URL, so it tested API endpoints against it and reported a false
  // "no API route" finding. This project's apps use a separate frontend/
  // backend origin; point Tier 3 at Riya's actual backend URL too.
  process.env.TIER3_REVIEW_BACKEND_URL = backendUrl;
  const previousDbUrl = process.env.TIER3_DB_URL;
  const dbUrl = reviewDbUrlForBuild(stage4Result.frontendOutputDir);
  if (dbUrl) process.env.TIER3_DB_URL = dbUrl;
  try {
    // 2026-08-31: reordered to run BEFORE Stage 5 / Tier 3 / live-eval — real
    // live evidence (project 05b590e98102) that these two mechanical checks
    // used to run LAST, after both full Tilotma browser passes (up to
    // ~67 iterations each) and the subjective live-eval pass had already
    // completed. A stack-conformance violation is a package.json string
    // comparison — no browser, no LLM call needed to detect it — so paying
    // for the two most expensive stages in this function first, only to
    // discover the build was going to fail a file-read check anyway, wastes
    // the majority of a Stage 6 attempt's wall-clock time. An infra/read error
    // (missing spec.json, a browser worker crash) is "not checked" with the
    // reason (2026-10-04) — only a REAL comparison result blocks delivery or
    // skips the expensive stages below.
    let specCompliance: SpecComplianceResult | undefined;
    if (!browserReviewOnly) try {
      const spec = await readProjectSpec(projectId);
      specCompliance = await runSpecComplianceCheck(spec, appUrl);
      if (!specCompliance.pass) {
        console.error(`[stage6] Spec-compliance check FAILED:\n${specCompliance.violations.join("\n")}`);
      }
    } catch (err) {
      notChecked.push(`spec check could not run: ${String(err).slice(0, 300)}`);
    }

    // Cheapest of all — pure file read, no live URL needed at all.
    let stackConformance: SpecComplianceResult | undefined;
    if (!browserReviewOnly) try {
      stackConformance = await runStackConformanceCheck(stage4Result.frontendOutputDir);
      notChecked.push(...(stackConformance.notChecked ?? []));
      if (!stackConformance.pass) {
        console.error(`[stage6] Stack-conformance check FAILED:\n${stackConformance.violations.join("\n")}`);
      }
    } catch (err) {
      notChecked.push(`stack check could not run: ${String(err).slice(0, 300)}`);
    }

    // 2026-08-05: BOTH checks above previously blocked `pass` correctly but
    // never contributed to `findings` — the fix loop in runStage6 only ever
    // reads `retest.findings` to decide what to route to fixShubham/fixAanya
    // (splitLiveFindings → agentForFile), so a spec-compliance or stack-
    // conformance failure had no fix path at all: it would just burn through
    // MAX_LIVE_FIX_ATTEMPTS unfixed and end in a stuck failure requiring a
    // human, even though the actual fix (swap a color, remove a banned
    // dependency) is exactly the kind of small, targeted edit runFix already
    // handles well. Merging their violations into `findings` (as
    // Finding-shaped objects — see toFindings) closes that gap: they now
    // route to Aanya via the same agentForFile("frontend/...") path every
    // other frontend finding uses, and get re-verified on the next retest
    // loop iteration exactly like any Navya/Karan/Deepika finding — no full
    // plan/spec rebuild, just a targeted edit to the existing generated files.
    const complianceFindings = [
      ...(specCompliance ? toFindings(specCompliance, "frontend/app/theme-overrides.css") : []),
      ...(stackConformance ? toFindings(stackConformance, "frontend/package.json") : []),
    ];
    const specComplianceOk = specCompliance ? specCompliance.pass : true;
    const stackConformanceOk = stackConformance ? stackConformance.pass : true;

    if (shouldSkipExpensiveReview(specComplianceOk, stackConformanceOk)) {
      // Same "don't spend the expensive stages on a build that's about to
      // loop back anyway" reasoning the old !result.pass early-return below
      // already applied to Stage 5 — now applied one layer earlier, before
      // Stage 5 and liveEval even start, since a compliance failure needs
      // the exact same targeted-fix-and-redeploy cycle regardless of what
      // Stage 5/liveEval would have found.
      return { pass: false, findings: complianceFindings, specCompliance };
    }

    // 2026-10-01: deterministic sign-up -> sign-in -> sign-out check (see
    // auth-smoke.ts). A definite failure skips the expensive review, exactly
    // like the compliance checks above — the fix loop then redeploys and the
    // FULL retest runs again. A skip or pass changes nothing. Off switch:
    // AUTH_SMOKE_TEST=off.
    if (process.env.AUTH_SMOKE_TEST !== "off" && plan && !browserReviewOnly) {
      const { BrowserSession } = await import("../../../packages/agent-runtime/src/browser/client.ts");
      const browser = new BrowserSession();
      try {
        const smoke = await runAuthSmokeTest({ appUrl, backendUrl, endpoints: plan.apiContract.endpoints, browser });
        console.log(`[stage6] Auth smoke test: ${smoke.ran ? (smoke.pass ? "passed" : "FAILED") : `skipped (${smoke.skippedReason})`}`);
        // An app with no sign-up/sign-in has nothing to check; any other skip
        // means the check could not look.
        if (!smoke.ran && !/has no sign-up and sign-in endpoints/.test(smoke.skippedReason ?? "")) {
          notChecked.push(`sign-up/sign-in check: ${smoke.skippedReason}`);
        }
        if (smoke.ran && !smoke.pass) {
          return { pass: false, findings: smoke.findings.map((issue) => ({ file: "frontend/app", issue: `[auth-smoke] ${issue}` })), specCompliance };
        }
      } finally {
        await browser.close().catch(() => {});
      }
    }

    // 2026-10-05 (Amit): ONE ready test account with sample data serves the route sweep and every review agent
    // below, so the whole user flow is walked with real records and a flow that fails is caught before delivery.
    // The account sits on the reserved test domain; it and everything under it are removed — and the row counts
    // compared with those from before — when the review ends (runRealLiveRetest). Off switches: REVIEW_ACCOUNT=off,
    // SEED_SAMPLE_DATA=off.
    let reviewSession: { token: string } | undefined;
    // The same accounts serve the acceptance tests: "user" is the ordinary account, the rest are the plan's roles.
    const runnerAccounts: Record<string, RunnerAccount> = {};
    let seededResult: { created: Record<string, string[]>; notSeeded: string[] } | undefined;
    if (process.env.REVIEW_ACCOUNT !== "off" && plan) {
      try {
        const acct = await createReviewAccount({ backendUrl, endpoints: plan.apiContract.endpoints });
        if ("reason" in acct) {
          console.error(`[stage6] Review account NOT created — the agents get no sample data: ${acct.reason}`);
          notChecked.push(`review account: ${acct.reason}`);
        } else {
          reviewSession = { token: acct.token };
          runnerAccounts.user = { email: acct.email, password: acct.password, token: acct.token };
          process.env.TIER3_REVIEW_EMAIL = acct.email;
          process.env.TIER3_REVIEW_PASSWORD = acct.password;
          // 2026-10-24 (Brewline live review): one test account per role the contract limits pages to ("(staff only)"),
          // given its role between sign-up and sign-in so its token carries it. Without one the reality checker hunted
          // for a staff login and had a sub-check overwrite the real staff password. These accounts are on the reserved
          // test domain too, so the cleanup removes them with everything under them.
          const roleAccounts: Array<{ role: string; email: string; password: string; token: string }> = [];
          for (const role of limitedRolesFromContract(plan.apiContract.endpoints as Array<{ description?: string }>)) {
            let grant: { ok: true } | { reason: string } = { reason: "the account was not created" };
            const ra = await createReviewAccount({
              backendUrl,
              endpoints: plan.apiContract.endpoints,
              label: role,
              beforeLogin: (email) => { grant = grantTestAccountRole(buildDirFor(projectId), email, role); },
            });
            if ("reason" in ra) notChecked.push(`${role} review account: ${ra.reason}`);
            else if ("reason" in grant) notChecked.push(`${role} review account: the role could not be given (${(grant as { reason: string }).reason})`);
            else roleAccounts.push({ role, ...ra });
          }
          process.env.TIER3_REVIEW_ROLE_ACCOUNTS = JSON.stringify(roleAccounts.map(({ role, email, password }) => ({ role, email, password })));
          if (roleAccounts.length > 0) console.log(`[stage6] Role accounts ready: ${roleAccounts.map((a) => a.role).join(", ")}`);
          for (const a of roleAccounts) runnerAccounts[a.role] = { email: a.email, password: a.password, token: a.token };
          if (process.env.SEED_SAMPLE_DATA !== "off") {
            // Each record is created by an account allowed to create it: the ordinary account first, then each role
            // account for what it alone may add (a menu item), then the ordinary account again for what needs those
            // (an order of a menu item). Only what no account could create is reported.
            const created: Record<string, string[]> = {};
            let last: { created: Record<string, string[]>; notSeeded: string[] } = { created: {}, notSeeded: [] };
            for (const token of [acct.token, ...roleAccounts.map((a) => a.token), acct.token]) {
              last = await seedSampleData(buildDirFor(projectId), backendUrl, token, 2, new Set(Object.keys(created)));
              for (const [k, ids] of Object.entries(last.created)) (created[k] ??= []).push(...ids);
            }
            seededResult = { created, notSeeded: last.notSeeded };
            notChecked.push(...seededResult.notSeeded);
            process.env.TIER3_REVIEW_SEEDED = JSON.stringify(Object.fromEntries(Object.entries(seededResult.created).map(([k, ids]) => [k, ids.length])));
            console.log(`[stage6] Review account ready with sample data: ${process.env.TIER3_REVIEW_SEEDED}`);
          }
        }
      } catch (err) {
        notChecked.push(`review account could not be set up: ${String(err).slice(0, 300)}`);
      }
    }

    // 2026-10-29 (team plan, stage 3): the acceptance tests the tester wrote from the approved plan, run by the fixed runner
    // (no model) on the running app with the review accounts above. Every run is recorded for the report; in this stage the
    // result does not decide anything (stage 4 makes passing tests the definition of done). Records a test creates are
    // added to the cleanup list, and the app's sign-in limiter is reset afterwards so the checks below are not refused.
    // Off switch: ACCEPTANCE_TESTS=off.
    if (process.env.ACCEPTANCE_TESTS !== "off" && !browserReviewOnly) {
      const suite = readAcceptanceTests(buildDirFor(projectId));
      if (suite?.tests.length) {
        try {
          const { BrowserSession } = await import("../../../packages/agent-runtime/src/browser/client.ts");
          const run = await runAcceptanceTests(suite.tests, {
            apiUrl: backendUrl,
            appUrl,
            accounts: runnerAccounts,
            openBrowser: async () => new BrowserSession(),
            onCreated: (id) => recordSeededRecords(buildDirFor(projectId), { acceptance: [id] }),
          });
          recordAcceptanceRun(buildDirFor(projectId), run);
          console.log(`[stage6] Acceptance tests: ${run.passed} passed, ${run.failed} failed, ${run.notChecked} not checked (of ${run.results.length})`);
          for (const r of run.results.filter((x) => x.status !== "passed")) console.log(`[stage6]   ${r.id} [${r.planItem}] ${r.status}: ${r.detail.slice(0, 240)}`);
        } catch (err) {
          notChecked.push(`acceptance tests could not run: ${String(err).slice(0, 300)}`);
        }
        const reset = await resetAppRateLimits(buildDirFor(projectId), backendUrl);
        if (!reset.ok) console.warn(`[stage6] could not reset the app's rate limits after the acceptance tests: ${reset.reason}`);
      }
    }

    // 2026-10-05 (Ledgerly run 4): the route sweep opens EVERY page of the app in a real browser, signed out
    // and signed in (see route-sweep.ts) — the agents below only visit the pages they choose to click
    // through. No model, so it runs before them: a broken page, a dead link or a failing request skips the
    // expensive review exactly like the checks above. Off switch: ROUTE_SWEEP=off.
    if (process.env.ROUTE_SWEEP !== "off" && !browserReviewOnly) {
      try {
        // The account and its sample data were made above; the sweep signs in with it and opens the detail pages
        // with the ids of the sample records (it makes its own account only when none could be created).
        const seed = seededResult ? async () => ({ created: seededResult!.created, notSeeded: [] as string[] }) : undefined;
        const sweep = await runRouteSweepReal(stage4Result.frontendOutputDir, appUrl, backendUrl, plan?.apiContract.endpoints ?? [], seed, reviewSession);
        console.log(`[stage6] Route sweep: ${sweep.ran ? (sweep.pass ? "passed" : "FAILED") : "did not run"} (${sweep.visited} page visits)`);
        notChecked.push(...sweep.notChecked);
        if (sweep.ran && !sweep.pass) {
          console.error(`[stage6] Route sweep FAILED:\n${sweep.findings.map((f) => `${f.file}: ${f.issue}`).join("\n")}`);
          return { pass: false, findings: sweep.findings, specCompliance };
        }
      } catch (err) {
        notChecked.push(`route sweep could not run: ${String(err).slice(0, 300)}`);
      }
    }

    // includeTier3=true: this runs AFTER a real deploy, pointed at the
    // actual live URL — the one place Tier 3 can legitimately run. See
    // runStage5's own comment for why the pre-deployment gate defaults to
    // false instead.
    // After a fix round the reviewers re-read only the files that changed; the
    // live review of the running app (Tier 3) still covers the whole app.
    let result: Stage5Result;
    if (browserReviewOnly) {
      // Only the live browser review (Tier 3), mapped exactly as runStage5 maps it.
      const { runTier3Review } = await import("../../../agents/tilotma/src/tier3-review.ts");
      const t3 = await runTier3Review(projectId, stage4Result.frontendOutputDir);
      result = t3.incomplete
        ? { pass: false, findings: [], notChecked: [t3.incomplete], tier3Ran: true }
        : { pass: t3.pass, findings: t3.pass ? [] : t3.findings.map((issue): Finding => ({ file: "", issue })), tier3Ran: true };
    } else {
      result = await runStage5(projectId, stage4Result, true, plan, changedFiles && changedFiles.length > 0 ? changedFiles : undefined);
    }
    // A review that could not finish is "not checked", not a failed app:
    // nothing to route, and the delivery is not verified (see runRealLiveRetest).
    if (result.notChecked?.length) {
      notChecked.push(...result.notChecked);
      if (result.findings.length === 0) return { pass: true, findings: [], specCompliance };
    }
    if (!result.pass) {
      // Don't spend a live browser evaluation judging the design of an app
      // that's about to loop back for objective bug fixes anyway — System B
      // only runs once System A (findings) + Tier 3 (does it work) agree
      // the app is objectively sound. `liveEval` stays absent here, which
      // buildDeliverySummary treats as "didn't run", not "failed".
      return { pass: result.pass, findings: result.findings, specCompliance, ...(result.tier3Ran || browserReviewOnly ? {} : { needsBrowserReview: true }) };
    }

    // 2026-07-24 (P2): System B — the app is objectively correct; now judge
    // whether it's actually good, not generic AI-slop that happens to work.
    const liveEval = await runLiveEval(projectId, appUrl, stage4Result.frontendOutputDir);
    // Unscored: the design could not be judged. Not a failure and not a pass —
    // "not checked", so the delivery is "not verified" rather than "delivered".
    if (liveEval.unscored) notChecked.push("design review: the evaluator did not produce scores, even when asked again");

    return {
      pass: result.pass && (liveEval.pass || liveEval.unscored === true),
      findings: [...result.findings, ...designFindings(liveEval)],
      liveEval,
      specCompliance,
    };
  } finally {
    if (previousUrl === undefined) {
      delete process.env.TIER3_REVIEW_URL;
    } else {
      process.env.TIER3_REVIEW_URL = previousUrl;
    }
    if (previousBackendUrl === undefined) {
      delete process.env.TIER3_REVIEW_BACKEND_URL;
    } else {
      process.env.TIER3_REVIEW_BACKEND_URL = previousBackendUrl;
    }
    if (previousDbUrl === undefined) {
      delete process.env.TIER3_DB_URL;
    } else {
      process.env.TIER3_DB_URL = previousDbUrl;
    }
    delete process.env.TIER3_REVIEW_EMAIL;
    delete process.env.TIER3_REVIEW_PASSWORD;
    delete process.env.TIER3_REVIEW_SEEDED;
    delete process.env.TIER3_REVIEW_ROLE_ACCOUNTS;
  }
}

// Injectable seam for testing — runStage6() below wraps this with the real
// Riya.run + the real live-retest. Real docker deployment and a real live
// LLM-driven QA re-run are not unit-testable; the deterministic parts this
// stage owns (flag plumbing, fail-fast on deploy failure, delivery summary
// shape) are what stage6-deployment.test.ts covers via injected stubs — none
// of those tests rely on the default, they all pass their own `deps`.
//
// `dbCheckFn` is optional in the interface — existing tests that pass a
// `deps` without it get `undefined`, and the runStage6 body treats that as
// "skip the pre-flight, caller is responsible" (the production default wires
// in the real check; test stubs don't need a real DB to exist).
export interface Stage6Deps {
  // 2026-07-28 (live, complex1): optional 3rd param so the fix-loop's
  // redeploy calls below can request a larger iteration budget than the
  // FIRST deploy — see REDEPLOY_MAX_ITERATIONS' header comment.
  deployFn: (projectId: string, deployTarget: "local" | "gcp", maxIterations?: number) => Promise<DeployResult>;
  // changedFiles (2026-10-04): the labeled files ("backend/src/x.ts") a fix round changed since the
  // last review; absent on the first review, which reads everything.
  liveRetestFn: (projectId: string, appUrl: string, backendUrl: string, changedFiles?: string[]) => Promise<LiveRetestResult>;
  // 2026-10-25: the live browser review and the design score alone, run when a pass still owes them (needsBrowserReview).
  // Absent in tests that stub the live retest; the real entry point wires it.
  browserReviewFn?: (projectId: string, appUrl: string, backendUrl: string) => Promise<LiveRetestResult>;
  dbCheckFn?: () => Promise<boolean>;
  // 2026-07-28 (live, complex1): escalations is optional on both — existing
  // DI test stubs (which return only {success}) keep compiling unchanged,
  // matching the same convention stage5-qa-fix-loop.ts's QAFixDeps uses.
  fixShubham?: (plan: BuildPlan, findings: string[]) => Promise<{ success: boolean; escalations?: Escalation[]; filesWritten?: string[] }>;
  fixAanya?: (plan: BuildPlan, findings: string[]) => Promise<{ success: boolean; escalations?: Escalation[]; filesWritten?: string[] }>;
  // 2026-07-28 (live, complex1): the live post-deploy retest previously had
  // NO fix path for db-owned findings at all — a schema finding (e.g.
  // "backend/init.sql: missing index") was either misrouted to shubham (who
  // is instructed to never touch schema files) or silently dropped if it
  // arrived alone. Optional, same convention as fixShubham/fixAanya above;
  // the real entry point wires Pranav's real runFix.
  fixPranav?: (plan: BuildPlan, findings: string[]) => Promise<{ success: boolean; escalations?: Escalation[]; filesWritten?: string[] }>;
  // 2026-08-05: injectable so tests exercising deployWithQuotaRetry's retry
  // path don't actually wait QUOTA_RETRY_BACKOFF_MS (90s) — defaults to a
  // real setTimeout-based sleep in production (deployWithQuotaRetry's own
  // default param), never set by the real entry point below.
  sleepFn?: (ms: number) => Promise<void>;
  // 2026-10-03 (evidence-only plan): Tilotma settles findings a builder
  // disputed. The real entry point checks them on the running app.
  settleDisputes?: SettleFn;
  // 2026-10-24: the Chief AI's one-call check of model-written findings before any fix (../chief-check.ts). Absent in
  // tests that build their own deps, so their findings pass unchanged; the real stage always has it.
  chiefChat?: ChiefChat | null;
  // 2026-10-04 (progress guard): judges each finished live review round; a
  // hold stops the loop before any fix is paid for. Optional so DI tests keep
  // working; the real entry point wires the real guard.
  roundGuard?: (findings: unknown[]) => Promise<GuardVerdict>;
}

// Pre-flight: verify NexSidi's own pipeline DB is reachable before spending
// agent-loop time on a deploy that will fail at the last step (persisting
// status) when the DB is down. Real bug found live (stress-pro): the entire
// Riya agent loop ran to completion, migration-and-verify passed, round-trip
// passed, then the status UPDATE threw ECONNREFUSED — all that work wasted.
async function checkNexsidiDbReachable(): Promise<boolean> {
  try {
    const { db } = await import("@nexsidi/db");
    const { sql } = await import("drizzle-orm");
    await (db as { execute: (q: unknown) => Promise<unknown> }).execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

// MAX_DEPLOY_ATTEMPTS: try deploy up to 2 times. On a second identical
// failure the loop exits early (stuck) rather than burning more tokens.
// Mirrors Stage 5's stuck-detection at the orchestrator level. 2 is the
// right ceiling: Riya's agent loop already retries internally (up to
// MAX_ITERATIONS); a second Stage-6-level attempt is a genuine re-try with a
// fresh context, not just noise. A third would almost certainly be stuck too.
const MAX_DEPLOY_ATTEMPTS = 2;
const MAX_LIVE_FIX_ATTEMPTS = 3;

// 2026-08-18: real bug found live (gatherly1) — both stuck-detection
// signatures below (errorSignature at the deploy-attempt loop, findingsSig
// at the live-retest fix loop) compared RAW error/finding text, which
// routinely embeds a freshly-random value on every single attempt — a UUID
// from a newly-created test row, e.g. "...did not persist to the database
// (id=8866159a-...)". Since that UUID differs every attempt, neither
// signature ever matched even when the underlying, STRUCTURAL problem was
// 100% identical each time. Confirmed live: the exact same two findings
// (a resource-name/table-name mismatch and a payload-generation gap, both
// in Riya's own verification tooling, not the generated app) recurred
// verbatim — modulo the UUID — across 6 consecutive attempts, burning
// through this file's own two retry loops AND the workflow's own outer
// auto-retry budget (which reads this activity's returned `stuck` flag,
// itself corrupted by the same root cause) before finally, correctly
// escalating. Stripping UUID-shaped substrings before comparing closes all
// three at once, since they all ultimately derive from these two signature
// computations.
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
export function normalizeForStuckComparison(text: string): string {
  return text.replace(UUID_PATTERN, "<id>");
}
const LIVE_STUCK_THRESHOLD = 2;

// 2026-08-05 (live, verify361300): distinguishes a redeploy failure caused by
// transient LLM rate-limit/circuit-breaker exhaustion from a genuine app-level
// deploy failure (bad docker-compose, migration error). Confirmed live: TWO
// consecutive redeploy attempts in the same build both failed on "every model
// in the pool is circuit-broken" (packages/agent-runtime/src/gemini-loop.ts's
// isAllPoolModelsExhaustedError) — the fix loop silently abandoned the rest of
// the live-retest cycle (System B's design/originality judge, and the spec-
// compliance check below) on BOTH attempts, because a redeploy failure
// immediately `break`s out regardless of WHY it failed. A genuine app bug
// won't fix itself by waiting, so it still fails fast as before; quota
// exhaustion is worth waiting out — the shared token bucket refills and
// circuit breakers reopen after packages/llm-client/src/circuit-breaker.ts's
// OPEN_TIMEOUT_MS (60s).
const QUOTA_RETRY_BACKOFF_MS = 90_000;
const MAX_QUOTA_RETRIES = 2;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Runs `deployAttempt` once, then retries (with a backoff wait, up to
// MAX_QUOTA_RETRIES times) ONLY when the failure is quota-exhaustion-shaped —
// any other failure reason returns immediately, unchanged from before.
export async function deployWithQuotaRetry(
  deployAttempt: () => Promise<DeployResult>,
  sleepFn: (ms: number) => Promise<void> = defaultSleep,
  log: (msg: string) => void = console.log,
): Promise<DeployResult> {
  let result = await deployAttempt();
  let retries = 0;
  while (!result.success && isQuotaExhaustionError(result.errors) && retries < MAX_QUOTA_RETRIES) {
    retries++;
    log(
      `[stage6] Deploy failed on LLM quota/circuit-breaker exhaustion — waiting ${QUOTA_RETRY_BACKOFF_MS}ms for recovery before retry ${retries}/${MAX_QUOTA_RETRIES}`,
    );
    await sleepFn(QUOTA_RETRY_BACKOFF_MS);
    result = await deployAttempt();
  }
  return result;
}

// 2026-07-28 (live, complex1): a redeploy INSIDE the fix loop follows a real
// code change and needs to diagnose+fix+rebuild+reverify against a running
// container — a fundamentally bigger task than the FIRST deploy (bring up a
// known-good compose file). See agents/riya/src/index.ts's run() header
// comment for the concrete evidence (a real parameterized-query bug with two
// separate occurrences consumed all 40 default iterations on continuously
// varying tool calls, never repeating — genuine progress cut off, not a
// stuck loop). Only applied to the redeploy call below, not the first deploy.
const REDEPLOY_MAX_ITERATIONS = 70;

function isStage6Deps(value: BuildPlan | Stage6Deps | undefined): value is Stage6Deps {
  return typeof value === "object" && value !== null && "deployFn" in value;
}

// 2026-07-28 (live, complex1): rewritten to route through the SAME
// agentForFile Stage 5's fix loop uses, instead of a second, independent
// backend/frontend-only prefix check. A finding on "backend/init.sql" (a
// real generated project's actual schema-file location) used to fall
// through to the shubham bucket via the old startsWith("backend/") check —
// see agentForFile's header comment in stage4-multi-agent-dev.ts for the
// full root cause and how it produced an unfixable, endlessly-recurring
// finding across every live-retest round.
export function splitLiveFindings(findings: unknown): { shubham: string[]; aanya: string[]; pranav: string[] } {
  const groups = { shubham: [] as string[], aanya: [] as string[], pranav: [] as string[] };
  if (!Array.isArray(findings)) return groups;
  for (const finding of findings as Array<{ file?: string; issue?: string; detail?: string }>) {
    const text = finding.issue ?? finding.detail ?? "";
    if (!finding.file) {
      // 2026-08-23: real bug found live (project a355bbb5fa35, nexyug web) —
      // Tier-3 (reality-checker) findings are built as `{ file: "", issue }`
      // (stage5-adversarial-qa.ts's tier3.findings.map), since Tier-3
      // reviews the whole live app, not one file. `!finding.file` is true
      // for "" too, so this branch used to `continue` unconditionally —
      // every Tier-3 finding was silently dropped before ever reaching
      // agentForFile, no matter how real or actionable. Confirmed live: a
      // genuine, confirmed finding ("missing global Header and Footer
      // across all routes") vanished this way, then the fix loop logged
      // "No specific findings to route" and exited without fixing anything,
      // even though a real finding existed. Route to Aanya specifically
      // (not agentForFile("")'s generic shubham default, used elsewhere for
      // a genuinely unfileable/non-actionable case — see
      // stage5-qa-fix-loop.ts's own comment): Tier-3 reviews the RENDERED
      // app, so its findings are almost always frontend/layout/UX, never
      // backend or schema.
      // 2026-10-04: a whole-app finding goes to the owner of a file its own
      // text names (Ledgerly run 4: a backend file went to the frontend
      // builder, which cannot edit it); only one that names none is frontend.
      const named = text.match(/((?:backend|frontend|db)\/[\w./-]+)/)?.[1];
      if (text && named) {
        const owner = agentForFile(named) as "shubham" | "aanya" | "pranav";
        if (owner === "shubham" || owner === "aanya" || owner === "pranav") {
          groups[owner].push(`${named}: ${text}`);
          continue;
        }
      }
      if (text) groups.aanya.push(`(site-wide): ${text}`);
      continue;
    }
    const formatted = `${finding.file}: ${text}`;
    const agent = agentForFile(finding.file) as "shubham" | "aanya" | "pranav";
    if (agent === "shubham" || agent === "aanya" || agent === "pranav") groups[agent].push(formatted);
  }
  return groups;
}

// 2026-10-03 (Ledgerly benchmark run 4): the deploy's own live checks found
// a real app bug — every invoice save returned 500 (the backend used
// ON CONFLICT on a unique constraint the migrations never created). The
// deploy loop only re-ran the identical deploy and stopped as stuck; no
// builder saw the error. Errors that come from the running app itself go to
// the builder that owns that layer. Everything else (a port clash, a docker
// build problem, a test value the app rightly rejected) is the deploy's own
// business and is retried as before.
const SERVER_ERROR = /returned 5\d\d\b/;
const DATABASE_ERROR = /no unique or exclusion constraint|violates (?:foreign key|unique|not-null|check) constraint|(?:relation|column) "?[\w.]+"? does not exist|syntax error at or near|invalid input syntax for type/i;

export function deployErrorsToFindings(errors: string[]): { shubham: string[]; aanya: string[]; pranav: string[] } {
  const groups = { shubham: [] as string[], aanya: [] as string[], pranav: [] as string[] };
  for (const error of errors) {
    if (/migrations did not apply|database has no tables|changed after it was applied|Database migration problem/i.test(error)) {
      groups.pranav.push(`The deployed database has no tables — the migrations did not apply. ${error}`);
    } else if (SERVER_ERROR.test(error) || DATABASE_ERROR.test(error) || error.startsWith("Backend log")) {
      groups.shubham.push(
        `The deployed app failed a live check: ${error}\n` +
        `Reproduce it against your code and the real migrations in ../db/migrations, find the cause and fix it. ` +
        `If the schema itself is wrong, escalate it to the database builder.`,
      );
    }
  }
  return groups;
}

export async function runStage6(
  projectId: string,
  stage4Result: Stage4Result,
  depsOrPlan?: Stage6Deps | BuildPlan,
  planOrUndefined?: BuildPlan,
): Promise<Stage6Result> {
  const flags = resolveFlags();

  let deps: Stage6Deps;
  let plan: BuildPlan | undefined = undefined;

  if (depsOrPlan && "deployFn" in (depsOrPlan as any)) {
    deps = depsOrPlan as Stage6Deps;
    if (planOrUndefined) plan = planOrUndefined;
  } else {
    if (depsOrPlan) plan = depsOrPlan as BuildPlan;
    deps = {
      deployFn: runRiya,
      liveRetestFn: (pid, appUrl, backendUrl, changed) => runRealLiveRetest(pid, appUrl, backendUrl, stage4Result, plan, changed),
      browserReviewFn: (pid, appUrl, backendUrl) => runRealLiveRetest(pid, appUrl, backendUrl, stage4Result, plan, undefined, true),
      dbCheckFn: checkNexsidiDbReachable,
      roundGuard: (findings) => checkRoundGuard(projectId, "live", findings as never),
      chiefChat: defaultChiefChat,
    };
  }

  // Pre-flight check
  const dbReachable = deps.dbCheckFn ? await deps.dbCheckFn() : true;
  if (!dbReachable) {
    const msg = "NexSidi pipeline database is not reachable — start the DB before running Stage 6";
    console.warn(`[stage6] Pre-flight FAILED: ${msg}`);
    const emptyDeploy: DeployResult = {
      success: false,
      appUrl: "",
      backendUrl: "",
      githubRepo: null,
      errors: [msg],
    };
    return {
      success: false,
      appUrl: "",
      findings: { deployErrors: [msg] },
      deliverySummary: buildDeliverySummary(emptyDeploy, { pass: false, findings: null }),
    };
  }

  const fixShubhamReal = deps.fixShubham ?? (async (p, f) => {
    const { runFix } = await import("../../../agents/generators/shubham/src/index.ts");
    // 2026-10-24: a fix round with findings in several files runs as a team (../team-fix.ts).
    return runFixAsTeam("shubham", p, f, (pp, ff, team) => runFix(pp, ff, team));
  });
  const fixAanyaReal = deps.fixAanya ?? (async (p, f) => {
    const { runFix } = await import("../../../agents/generators/aanya/src/index.ts");
    // 2026-10-24: a fix round with findings in several files runs as a team (../team-fix.ts).
    return runFixAsTeam("aanya", p, f, (pp, ff, team) => runFix(pp, ff, team));
  });
  const fixPranavReal = deps.fixPranav ?? (async (p, f) => {
    const { runFix } = await import("../../../agents/generators/pranav/src/index.ts");
    return runFix(p, f);
  });

  // Labeled files the builders changed since the last review (2026-10-04).
  const changedSinceReview = new Set<string>();
  const labelFor: Record<"shubham" | "aanya" | "pranav", string> = { shubham: "backend", aanya: "frontend", pranav: "db" };
  type FixFn = (p: BuildPlan, f: string[]) => Promise<{ success: boolean; escalations?: Escalation[]; filesWritten?: string[] }>;
  const settleReal: SettleFn = deps.settleDisputes ?? (async (pid, disputes) => {
    const { settleDisputes } = await import("../../../agents/tilotma/src/settle-disputes.ts");
    return settleDisputes(pid, disputes, {
      reviewRoot: buildDirFor(pid),
      appUrl: deployResult?.appUrl || undefined,
      backendUrl: deployResult?.backendUrl || undefined,
    });
  });
  const fixerFor: Record<"shubham" | "aanya" | "pranav", FixFn> = { shubham: fixShubhamReal, aanya: fixAanyaReal, pranav: fixPranavReal };

  // One fix round: every owner with findings fixes in parallel, then any
  // finding a fixer escalated to another owner is fixed in the same round.
  // "nothing_changed" means every fix failed without touching a file, so a
  // redeploy could only reproduce the same result.
  const runOwnerFixes = async (
    fixPlan: BuildPlan,
    routed: { shubham: string[]; aanya: string[]; pranav: string[] },
  ): Promise<"nothing_to_fix" | "nothing_changed" | "changed" | "waiting_for_customer"> => {
    const owners = (["shubham", "aanya", "pranav"] as const).filter((o) => routed[o].length > 0);
    if (owners.length === 0) return "nothing_to_fix";
    const roundStart = new Date().toISOString();
    const fixResults = await Promise.all(owners.map((owner) => {
      console.log(`[stage6] Routing ${routed[owner].length} findings to ${owner[0]!.toUpperCase()}${owner.slice(1)}`);
      return fixerFor[owner](fixPlan, routed[owner]).then((r) => {
        for (const f of r.filesWritten ?? []) changedSinceReview.add(`${labelFor[owner]}/${f}`);
        return { agent: owner, ...r };
      });
    }));
    // 2026-07-26 (autonomy/throughput pass): a fix agent that genuinely
    // failed to complete still triggered a full docker redeploy + retest
    // that could only reproduce the same findings. 2026-09-29: a failed fix
    // that wrote files changed the code (see fixChangedCode) — only skip
    // when nothing was touched.
    const fixesChangedNothing = fixResults.every((r) => !fixChangedCode(r));
    if (fixResults.some((r) => !r.success)) {
      console.error(`[stage6] one or more fixes did not finish this round — redeploying anyway since code was changed`);
    }
    // 2026-07-28 / 2026-08-16 (live, complex1, fulfillio1): a fix agent may
    // decide the real fix belongs in another agent's domain
    // (escalate_finding) — routed in this same round, so it lands before
    // the redeploy instead of a whole wasted round later.
    // 2026-10-04: a fix made on an escalated finding is a change too — before,
    // only the first builders' results were counted and the redeploy was skipped.
    let escalationChanged = false;
    const escalationsByTarget: Record<"shubham" | "aanya" | "pranav", Escalation[]> = { shubham: [], aanya: [], pranav: [] };
    for (const e of fixResults.flatMap((r) => r.escalations ?? [])) escalationsByTarget[e.targetAgent].push(e);
    for (const target of ["shubham", "aanya", "pranav"] as const) {
      const targeted = escalationsByTarget[target];
      if (targeted.length === 0) continue;
      const formatted = targeted.map((e) => `${e.finding} — ${e.reason}`);
      console.log(`[stage6] routing ${formatted.length} escalated finding(s) to ${target} this round`);
      const escalationResult = await fixerFor[target](fixPlan, formatted);
      for (const f of escalationResult.filesWritten ?? []) changedSinceReview.add(`${labelFor[target]}/${f}`);
      if (fixChangedCode(escalationResult)) escalationChanged = true;
      if (!escalationResult.success) {
        console.error(`[stage6] ${target} escalation fix FAILED to complete`);
      }
    }
    // 2026-10-03 (evidence-only plan): findings the builders disputed this
    // round go to Tilotma; confirmed ones go back with her evidence, ones she
    // rules not true are dropped from the retest.
    const disputes = await resolveDisputes(projectId, roundStart, fixPlan, {
      settle: settleReal,
      fixers: Object.fromEntries((["shubham", "aanya", "pranav"] as const).map((o) => [o, async (p: BuildPlan, f: string[]) => {
        const r = await fixerFor[o](p, f);
        for (const file of r.filesWritten ?? []) changedSinceReview.add(`${labelFor[o]}/${file}`);
        return r;
      }])),
    });
    // 2026-10-29 (team plan, stage 2): a builder asked the customer; nothing is redeployed or reviewed until the answer is in.
    if (openCustomerQuestions(projectId).length > 0) {
      console.log(`[stage6] a builder asked the customer a question — stopping until it is answered`);
      return "waiting_for_customer";
    }
    if (fixesChangedNothing && !escalationChanged && disputes.settledNotTrue === 0 && !disputes.refixChanged) {
      console.error(`[stage6] every implicated fix this round failed outright and changed nothing — skipping redeploy, a retest would be wasted`);
      return "nothing_changed";
    }
    return "changed";
  };

  let deployResult!: DeployResult;
  let prevErrorSignature = "";
  let stuck = false;
  let plainRetries = 0;
  let deployFixRounds = 0;
  let afterFix = false;

  for (let attempt = 1; ; attempt++) {
    deployResult = await deployWithQuotaRetry(
      () => deps.deployFn(projectId, flags.deployTarget, afterFix ? REDEPLOY_MAX_ITERATIONS : undefined),
      deps.sleepFn,
    );

    if (deployResult.success) break;

    const errorSignature = [...deployResult.errors].map(normalizeForStuckComparison).sort().join("\0");
    if (attempt > 1 && prevErrorSignature === errorSignature && errorSignature !== "") {
      stuck = true;
      console.log(
        `[stage6] Stuck: deploy attempt ${attempt} has the identical error list as attempt ${attempt - 1} — stopping rather than retrying`,
      );
      break;
    }
    prevErrorSignature = errorSignature;

    const routed = deployErrorsToFindings(deployResult.errors);
    if (plan && deployFixRounds < MAX_LIVE_FIX_ATTEMPTS && (routed.shubham.length + routed.aanya.length + routed.pranav.length) > 0) {
      deployFixRounds++;
      console.log(`[stage6] Deploy attempt ${attempt} found real app errors — sending them to the builders (fix round ${deployFixRounds} of ${MAX_LIVE_FIX_ATTEMPTS})`);
      const outcome = await runOwnerFixes(plan, routed);
      if (outcome === "waiting_for_customer") break;
      if (outcome === "changed") {
        afterFix = true;
        console.log(`[stage6] Fixes for the deploy errors are in — deploying again`);
        continue;
      }
      break;
    }

    if (plainRetries + 1 >= MAX_DEPLOY_ATTEMPTS) break;
    plainRetries++;
    afterFix = false;
    console.log(
      `[stage6] Deploy attempt ${attempt} failed — retrying (${MAX_DEPLOY_ATTEMPTS - plainRetries} left): ${deployResult.errors.join("; ").slice(0, 200)}`,
    );
  }

  if (!deployResult.success) {
    return {
      success: false,
      appUrl: deployResult.appUrl,
      findings: { deployErrors: deployResult.errors, ...(stuck ? { stuck: true } : {}) },
      deliverySummary: buildDeliverySummary(deployResult, { pass: false, findings: null }),
      ...(stuck ? { stuck: true } : {}),
    };
  }

  // One live review as the loop sees it: the checks, the Chief AI's gate, and, when the pass only came because the static
  // reviewers' findings were set aside, the live browser review and the design score it still owes.
  const reviewLive = async (changed?: string[]): Promise<LiveRetestResult> => {
    const first = await gateLiveFindings(projectId, withHygieneFindings(projectId, guardLiveRetest(projectId, await deps.liveRetestFn(projectId, deployResult.appUrl, deployResult.backendUrl, changed))), deps.chiefChat);
    if (!(first.pass && first.needsBrowserReview) || !deps.browserReviewFn) return first;
    console.log(`[stage6] the static reviewers' findings were all outside the plan - running the live browser review and the design score now`);
    const second = await gateLiveFindings(projectId, guardLiveRetest(projectId, await deps.browserReviewFn(projectId, deployResult.appUrl, deployResult.backendUrl)), deps.chiefChat);
    return { ...second, specCompliance: first.specCompliance ?? second.specCompliance, notChecked: [...(first.notChecked ?? []), ...(second.notChecked ?? [])], needsBrowserReview: false };
  };
  let retest = await reviewLive();
  changedSinceReview.clear(); // the first review reads everything, so earlier changes are already covered
  let prevFindingsSig = "";
  let fixAttempt = 0;
  // 2026-10-04 (Ledgerly run 4): a stuck loop, or a round where nothing could
  // change, must be reported as stuck — otherwise the workflow reads the
  // failure as progress and re-runs the whole stage.
  let liveStuck = false;
  let liveHold: { reason: string; evidence: string[] } | undefined;
  let reviewRetries = 0;
  // 2026-10-25: the live stage's time budget (time-budget.ts): when it is used up no new fix round and redeploy starts.
  const liveStartedAt = Date.now();

  while (!retest.pass && fixAttempt < MAX_LIVE_FIX_ATTEMPTS) {
    if (Date.now() - liveStartedAt > liveBudgetMs()) {
      const open = Array.isArray(retest.findings) ? (retest.findings as Array<{ file?: string; issue?: string }>).map((f) => `${f.file ? `${f.file}: ` : ""}${f.issue ?? ""}`) : [];
      console.log(`[stage6] time budget reached (${minutesSince(liveStartedAt)} minutes, ${open.length} finding(s) open) — no further live round`);
      liveHold = { reason: `the live stage's time budget of ${Math.round(liveBudgetMs() / 60_000)} minutes was used up with ${open.length} finding(s) still open`, evidence: open };
      liveStuck = true;
      break;
    }
    // 2026-10-23: no new live round once the spend cap is reached; the step then raises the budget stop.
    if (await isOverBudget(projectId)) {
      console.log(`[stage6] budget_exceeded — the spend cap was reached, no further live round`);
      liveStuck = true;
      break;
    }
    // 2026-10-24: only a reviewer failed (nothing to fix in the app): run the review again — no fix, no redeploy — once.
    if (retest.reviewIncomplete && reviewRetries < 1) {
      reviewRetries++;
      console.log(`[stage6] a reviewer did not finish and nothing else is open — running the review again (no fix, no redeploy)`);
      retest = await reviewLive();
      continue;
    }
    if (retest.reviewIncomplete) {
      console.log(`[stage6] the review could not finish twice — stopping without routing anything to a builder`);
      break;
    }
    fixAttempt++;
    console.log(`[stage6] Live retest failed (attempt ${fixAttempt} of ${MAX_LIVE_FIX_ATTEMPTS}) — starting agentic fix loop`);

    // 2026-10-04 (progress guard): before any fix is paid for, judge this
    // review round against the earlier ones.
    if (deps.roundGuard && Array.isArray(retest.findings) && retest.findings.length > 0) {
      // 2026-10-22: a finding that came back is checked before the guard may hold on it (disputes.ts).
      const { settleRepeatsBeforeGuard } = await import("../disputes.ts");
      const kept = await settleRepeatsBeforeGuard(projectId, "live", retest.findings as never[], settleReal);
      // 2026-10-25 (brewline2): findings Tilotma rules not true are gone, not open. When none is left and the other verdicts
      // (design, spec) pass, the round has passed; it used to stay "failed" with nothing to fix and escalate a human.
      const othersPass = retest.liveEval?.pass !== false && retest.specCompliance?.pass !== false;
      retest = { ...retest, findings: kept, ...(kept.length === 0 && othersPass ? { pass: true } : {}) };
      if (retest.pass) {
        console.log(`[stage6] every finding of this round was ruled not true — nothing is open`);
        break;
      }
    }
    if (deps.roundGuard && Array.isArray(retest.findings) && retest.findings.length > 0) {
      const verdict = await deps.roundGuard(retest.findings);
      if (verdict.hold) {
        liveHold = { reason: verdict.reason, evidence: verdict.evidence };
        liveStuck = true;
        break;
      }
    }

    const findingsSig = Array.isArray(retest.findings)
      ? [...retest.findings].map(f => normalizeForStuckComparison(`${f.file}:${f.issue || f.detail}`)).sort().join("\0")
      : normalizeForStuckComparison(String(retest.findings));

    if (fixAttempt > 1 && findingsSig === prevFindingsSig) {
      console.log(`[stage6] Stuck loop detected: findings signature did not change on attempt ${fixAttempt}`);
      liveStuck = true;
      break;
    }
    prevFindingsSig = findingsSig;

    // Log instinct mismatch if clean QA review missed CRITICAL findings
    try {
      const { readFileSync, existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { buildMismatchObservations, appendInstinctObservations } = await import("../../../packages/agent-runtime/src/instinct-observer.ts");
      
      const buildDir = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";
      const submissionsPath = join(buildDirFor(projectId, buildDir), "qa-submissions.json");
      if (existsSync(submissionsPath)) {
        const submissions = JSON.parse(readFileSync(submissionsPath, "utf-8"));
        const laterFindings = Array.isArray(retest.findings) ? retest.findings : [];
        const observations = buildMismatchObservations(submissions, laterFindings);
        if (observations.length > 0) {
          for (const obs of observations) {
            console.log(`[instinct-mismatch] agent ${obs.agentName} submitted 0 findings but later stage found CRITICAL: ${obs.missedFinding}`);
          }
          appendInstinctObservations(observations);
        }
      }
    } catch (obsErr) {
      console.error(`[stage6] Failed to record instinct observations: ${String(obsErr)}`);
    }

    if (plan) {
      const outcome = await runOwnerFixes(plan, splitLiveFindings(retest.findings));
      if (outcome === "waiting_for_customer") break;
      if (outcome === "nothing_to_fix") {
        console.log(`[stage6] No specific findings to route — exiting fix loop`);
        break;
      }
      if (outcome === "nothing_changed") {
        liveStuck = true;
        break;
      }

      console.log(`[stage6] Agent fixes completed — redeploying app via Riya`);

      let redeployResult = await deployWithQuotaRetry(
        () => deps.deployFn(projectId, flags.deployTarget, REDEPLOY_MAX_ITERATIONS),
        deps.sleepFn,
      );
      if (!redeployResult.success) {
        console.error(`[stage6] Redeployment failed: ${redeployResult.errors.join("; ")}`);
        deployResult = redeployResult;
        break;
      }
      deployResult = redeployResult;

      const changedForReview = [...changedSinceReview];
      changedSinceReview.clear();
      retest = await reviewLive(changedForReview.length > 0 ? changedForReview : undefined);
    } else {
      console.warn(`[stage6] No BuildPlan provided — cannot invoke agent fixes. Exiting fix loop.`);
      break;
    }
  }

  // Also log instinct mismatches on final test result if it fails
  if (!retest.pass) {
    try {
      const { readFileSync, existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { buildMismatchObservations, appendInstinctObservations } = await import("../../../packages/agent-runtime/src/instinct-observer.ts");
      
      const buildDir = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";
      const submissionsPath = join(buildDirFor(projectId, buildDir), "qa-submissions.json");
      if (existsSync(submissionsPath)) {
        const submissions = JSON.parse(readFileSync(submissionsPath, "utf-8"));
        const laterFindings = Array.isArray(retest.findings) ? retest.findings : [];
        const observations = buildMismatchObservations(submissions, laterFindings);
        if (observations.length > 0) {
          for (const obs of observations) {
            console.log(`[instinct-mismatch] agent ${obs.agentName} submitted 0 findings but later stage found CRITICAL: ${obs.missedFinding}`);
          }
          appendInstinctObservations(observations);
        }
      }
    } catch (obsErr) {
      console.error(`[stage6] Failed to record final instinct observations: ${String(obsErr)}`);
    }
  }

  // Checks the deploy itself could not run (see DeployResult.notChecked).
  const finalRetest = deployResult.notChecked?.length
    ? { ...retest, notChecked: [...deployResult.notChecked, ...(retest.notChecked ?? [])] }
    : retest;
  const deliverySummary = buildDeliverySummary(deployResult, finalRetest);
  return {
    // "not_verified" is not success: the workflow retries it and then asks a
    // human, with the reasons in deliverySummary.notChecked.
    success: retest.pass && deliverySummary.status === "delivered",
    appUrl: deployResult.appUrl,
    findings: retest.findings,
    deliverySummary,
    ...(liveStuck && !retest.pass ? { stuck: true } : {}),
    ...(liveHold ? { hold: liveHold } : {}),
  };
}

// Exported for the test file's confidentiality assertion — keeps the list of
// names to check in one place instead of duplicating it in the test.
export { INTERNAL_AGENT_NAMES };
