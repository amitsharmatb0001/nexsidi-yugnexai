// The acceptance gate (2026-10-30, team plan stage 4). "Done" used to count activity: a builder finished when it said so,
// and a fix counted when any file was written, disputed or handed on — so the review rounds found what the build had never
// shown to work. Now the build closes only when its acceptance tests (acceptance-tests.ts, written by the tester from the
// approved plan) pass on the running app:
//   1. the system starts the app (the deploy step's own fast path, no model when it works) and runs the tests;
//   2. each failing test goes, whole, to its owner — an API test to the backend builder, a journey to the frontend
//      builder; a builder that finds the cause in another folder hands it on (escalate_finding) and the owner fixes it in
//      the same round;
//   3. a fix run may finish only when its tests pass on the rebuilt app, or it has disputed a test with evidence (the
//      Chief AI rules: a test she finds wrong is withdrawn) or handed it on (acceptanceFixCheck below);
//   4. the rounds repeat while they make progress. Two rounds in a row with no more tests passing, or the round limit,
//      end the gate as "failing" and the workflow holds the build for a person.
// The builders of a feature share its tests, so they own the feature together. With builder teams (the default) the
// whole app is built in one pass, so the gate runs once, after the build; with several phases it runs after the last.
import { readAcceptanceTests, activeTests, withdrawTest, testSteps, type AcceptanceTest } from "./acceptance-tests.ts";
import type { RunSummary, TestResult } from "./acceptance-runner.ts";
import { buildDirFor } from "../../packages/agent-runtime/src/build-dir.ts";
import { readDisputes } from "../../packages/agent-runtime/src/tools/dispute.ts";
import { readEscalations } from "../../packages/agent-runtime/src/tools/escalate.ts";

export type Owner = "shubham" | "aanya" | "pranav";

export interface GateUrls {
  appUrl: string;
  backendUrl: string;
}

export interface GateFixResult {
  filesWritten: number;
  escalations: Array<{ targetAgent: Owner; finding: string; reason: string }>;
}

export interface GateDeps {
  /** start (or rebuild) the whole app */
  deploy(): Promise<GateUrls | { reason: string }>;
  run(tests: AcceptanceTest[], urls: GateUrls): Promise<RunSummary>;
  /** one owner's fix run for its failing tests; its finish check is acceptanceFixCheck */
  fix(owner: Owner, findings: string[], tests: AcceptanceTest[], ctx: { sinceIso: string; urls: GateUrls }): Promise<GateFixResult>;
  /** the Chief AI rules on this round's disputes; the tests she finds wrong come back to be withdrawn */
  settle(sinceIso: string): Promise<{ withdrawn: Array<{ id: string; evidence: string }> }>;
  /** budget and system-version checks before each paid round; throws to stop */
  beforeRound?(): Promise<void>;
  openQuestions?(): boolean;
  now?(): Date;
}

export interface GateResult {
  status: "passed" | "failing" | "not_checked" | "waiting_for_customer";
  rounds: number;
  last?: RunSummary;
  reason?: string;
  withdrawn: string[];
}

export function ownerOfTest(t: AcceptanceTest): Owner {
  return t.kind === "journey" ? "aanya" : "shubham";
}

const TEST_ID = /\bAT-\d+-\d+\b/g;

/** A failing test as a builder sees it: what failed, the whole test, and what a finished fix means. */
export function acceptanceFinding(t: AcceptanceTest, r: TestResult): string {
  return [
    `[acceptance ${t.id} / ${t.planItem}] ${t.title} (as ${t.as}) — fails on the running app${r.step ? ` at step ${r.step}` : ""}: ${r.detail}`,
    "The test (written from the approved plan; you cannot change it):",
    ...testSteps(t).map((l) => `  ${l}`),
    "A fix is done only when this test passes on the running app. If the test is wrong (it asks for something the approved plan does not), call dispute_finding with what you checked; if the cause is in another builder's folder, call escalate_finding.",
  ].join("\n");
}

export async function runAcceptanceGate(
  projectDir: string,
  deps: GateDeps,
  opts: { maxFixRounds?: number; stuckRounds?: number } = {},
): Promise<GateResult> {
  const maxFixRounds = opts.maxFixRounds ?? 4;
  const stuckRounds = opts.stuckRounds ?? 2;
  const now = deps.now ?? (() => new Date());
  const withdrawn: string[] = [];
  if (activeTests(readAcceptanceTests(projectDir)).length === 0) {
    return { status: "not_checked", rounds: 0, reason: "this build has no acceptance tests (none were written, or all were withdrawn)", withdrawn };
  }
  let best = -1;
  let stale = 0;
  let fixRounds = 0;
  let withdrewLastRound = false;
  for (;;) {
    await deps.beforeRound?.();
    const tests = activeTests(readAcceptanceTests(projectDir));
    if (tests.length === 0) return { status: "passed", rounds: fixRounds, reason: "every acceptance test was withdrawn by the Chief AI", withdrawn };
    const urls = await deps.deploy();
    if ("reason" in urls) return { status: "not_checked", rounds: fixRounds, reason: `the app could not be started: ${urls.reason}`, withdrawn };
    const run = await deps.run(tests, urls);
    const failing = run.results.filter((r) => r.status === "failed");
    console.log(`[acceptance-gate] round ${fixRounds + 1}: ${run.passed} passed, ${run.failed} failed, ${run.notChecked} not checked`);
    if (failing.length === 0) return { status: "passed", rounds: fixRounds, last: run, withdrawn };
    // Progress is tests passing, not files written (enforce/fix-accounting.ts).
    if (run.passed > best) {
      best = run.passed;
      stale = 0;
    } else if (fixRounds > 0 && !withdrewLastRound) {
      stale++;
    }
    const open = `still failing: ${failing.map((f) => `${f.id} [${f.planItem}]`).join(", ")}`;
    if (stale >= stuckRounds) return { status: "failing", rounds: fixRounds, last: run, reason: `${stale} fix rounds in a row made no more tests pass; ${open}`, withdrawn };
    if (fixRounds >= maxFixRounds) return { status: "failing", rounds: fixRounds, last: run, reason: `${maxFixRounds} fix rounds did not make every test pass; ${open}`, withdrawn };

    fixRounds++;
    const sinceIso = now().toISOString();
    const byId = new Map(tests.map((t) => [t.id, t]));
    const routed = new Map<Owner, { findings: string[]; tests: AcceptanceTest[] }>();
    const route = (owner: Owner, finding: string, ts: AcceptanceTest[]) => {
      const slot = routed.get(owner) ?? { findings: [], tests: [] };
      slot.findings.push(finding);
      for (const t of ts) if (!slot.tests.includes(t)) slot.tests.push(t);
      routed.set(owner, slot);
    };
    for (const r of failing) {
      const t = byId.get(r.id)!;
      route(ownerOfTest(t), acceptanceFinding(t, r), [t]);
    }
    const first = [...routed.entries()];
    const results = await Promise.all(first.map(([owner, w]) => deps.fix(owner, w.findings, w.tests, { sinceIso, urls }).then((res) => ({ owner, res }))));
    // A test handed to another owner is that owner's in the same round (once: no ping-pong).
    const handedOn = new Map<Owner, { findings: string[]; tests: AcceptanceTest[] }>();
    for (const { owner, res } of results) {
      for (const e of res.escalations) {
        if (e.targetAgent === owner) continue;
        const ts = [...new Set(e.finding.match(TEST_ID) ?? [])].map((id) => byId.get(id)).filter((t): t is AcceptanceTest => !!t);
        const slot = handedOn.get(e.targetAgent) ?? { findings: [], tests: [] };
        slot.findings.push(`Handed to you by the ${owner === "aanya" ? "frontend" : owner === "shubham" ? "backend" : "database"} builder: ${e.reason}\n${e.finding}`);
        slot.tests.push(...ts.filter((t) => !slot.tests.includes(t)));
        handedOn.set(e.targetAgent, slot);
      }
    }
    await Promise.all([...handedOn.entries()].map(([owner, w]) => deps.fix(owner, w.findings, w.tests, { sinceIso, urls })));
    if (deps.openQuestions?.()) return { status: "waiting_for_customer", rounds: fixRounds, last: run, withdrawn };
    // Only a test that still counts can be withdrawn; a ruling that repeats an earlier one is not progress.
    const ruled = (await deps.settle(sinceIso)).withdrawn.filter((w, i, all) => byId.has(w.id) && !withdrawn.includes(w.id) && all.findIndex((x) => x.id === w.id) === i);
    withdrewLastRound = ruled.length > 0;
    for (const w of ruled) {
      withdrawTest(projectDir, w.id, w.evidence);
      withdrawn.push(w.id);
      console.log(`[acceptance-gate] ${w.id} withdrawn: the Chief AI ruled the test wrong — ${w.evidence.slice(0, 200)}`);
    }
  }
}

/** The tests a fix run disputed or handed on since the round began (by their ids in the recorded text). */
function handledSince(projectId: string, sinceIso: string): Set<string> {
  const ids = new Set<string>();
  for (const d of readDisputes(projectId, sinceIso)) for (const id of d.finding.match(TEST_ID) ?? []) ids.add(id);
  for (const e of readEscalations(projectId, sinceIso)) for (const id of e.finding.match(TEST_ID) ?? []) ids.add(id);
  return ids;
}

/**
 * A fix run's finish check for its acceptance tests: the app is rebuilt with its change and its tests are run again. It may
 * finish when each one passes, or when it disputed the test or handed it on this round. A change that breaks the build blocks.
 */
export async function acceptanceFixCheck(
  projectId: string,
  tests: AcceptanceTest[],
  deps: { redeploy(): Promise<{ ok: true } | { ok: false; reason: string }>; run(tests: AcceptanceTest[]): Promise<RunSummary> },
  sinceIso: string,
): Promise<string[]> {
  const handled = handledSince(projectId, sinceIso);
  const mine = tests.filter((t) => !handled.has(t.id));
  if (mine.length === 0) return [];
  const rebuilt = await deps.redeploy();
  if (!rebuilt.ok) return [`The app did not rebuild and start after your change: ${rebuilt.reason}. Make the app build and start again, then finish.`];
  const run = await deps.run(mine);
  return run.results
    .filter((r) => r.status === "failed")
    .map((r) => `${r.id} [${r.planItem}] still fails on the running app${r.step ? ` at step ${r.step}` : ""}: ${r.detail}. A fix is done only when the test passes. If the test is wrong, call dispute_finding with what you checked; if the cause is in another builder's folder, call escalate_finding.`);
}

/** The project folder of a project id (for callers that hold only the id). */
export const gateDirFor = (projectId: string) => buildDirFor(projectId);
