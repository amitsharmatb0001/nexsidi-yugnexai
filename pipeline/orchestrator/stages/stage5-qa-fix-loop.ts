// Stage 5.5 — QA fix loop (A6, full-system audit Phase C).
//
// Before this, run.ts's own comment documented the gap directly: "a
// fault-isolated re-fix-and-retest loop (per the design doc) is a distinct,
// larger feature and is NOT implemented here." Every stress-test run this
// session reached Stage 5, got real findings, and the pipeline simply
// stopped — a bug-detector with no repair mechanism attached.
//
// Design, decided plainly (no unproven claims):
//   - On failure, route the SPECIFIC findings for the fault-isolated agent
//     (Stage 5's own identifyFaultAgent) to that agent's fix() function —
//     Shubham/Aanya only; Pranav has no agentic run() to fix with (his
//     generator is deterministic/templated, not a tool-calling loop), so a
//     "pranav" fault has no auto-fix path yet and the loop stops rather than
//     silently doing nothing.
//   - Stuck-detection metric is deliberately simple and stated as such: total
//     finding COUNT, not a unified numeric score. Unifying Karan's
//     zero-tolerance 0/100 with Navya/Deepika's severity-weighted scores into
//     one number is a real design decision this file does not make silently
//     — finding count is a legitimate, honestly-labeled proxy for
//     "did the fix help," not a claim of exact adherence to any score-based
//     design-doc language this codebase hasn't actually implemented anywhere.
//   - 2 consecutive fix-and-retest cycles with no reduction in finding count
//     -> stuck, stop (don't keep spinning on a fix that isn't working).
//   - Hard cap of 3 fix-and-retest cycles regardless (1 initial QA pass + up
//     to 3 retests = 4 QA calls max) — matches this codebase's own
//     "2-3 iterations is NORMAL" guidance elsewhere; a stuck-state exit is
//     the intended common case, the cap is the backstop against a runaway
//     loop, not the expected exit path.
import type { BuildPlan } from "../../../agents/arjun/src/index.ts";
import { groupFindingsByAgent, type Stage4Result, type Finding } from "./stage4-multi-agent-dev.ts";
import { runStage5, type Stage5Result, type Stage5RawFindings } from "./stage5-adversarial-qa.ts";
import type { InstinctDomain } from "@nexsidi/db";
import type { Escalation } from "../../../packages/agent-runtime/src/tools/escalate.ts";
import { runGeneratorWithQuotaRetry } from "../../activities/quota-retry.ts";
import { dropCodeContradictedFindings } from "../finding-evidence.ts";
import { dropSettledNotTrue, resolveDisputes, type SettleFn } from "../disputes.ts";
import { checkRoundGuard, type GuardVerdict } from "../progress-guard.ts";
import { join as joinPath } from "node:path";

export interface QAFixLoopResult extends Stage5Result {
  iterations: number; // total QA passes run (initial + retests)
  stuck: boolean;      // true if the loop exited via stuck-detection or an unfixable faultAgent, not a pass
  // 2026-10-04 (progress guard): set when the work was held — see ../progress-guard.ts
  hold?: { reason: string; evidence: string[] };
}

// History: 3 (original) -> 8 (2026-07-08, to survive a QA gate that was
// mis-configured as zero-tolerance and could never actually pass — see
// stage5-adversarial-qa.ts's scoreSecurityFindings comment) -> 5
// (2026-07-09/10, pulled back down). Each QA pass costs 3 full-codebase
// reviews (Navya/Karan/Deepika, up to ~80K tokens each) — with the gate now
// correctly conforming to CLAUDE.md System A (severity-weighted, pass ≥ 85,
// evidence-required findings), convergence should happen in far fewer
// rounds than 8 required against an unsatisfiable bar. 8 rounds was real
// cost with no corresponding benefit once the actual blocker (the gate,
// not the retry budget) was fixed. Stuck-detection (below) still stops a
// genuinely non-converging loop well before 5 rounds.
const MAX_FIX_ITERATIONS = 5; // retest cycles after the initial QA pass
const STUCK_THRESHOLD = 2; // consecutive no-improvement fix cycles before giving up

export interface QAFixDeps {
  // F5 (agent-autonomy-assessment): plan is optional third arg so existing
  // stubs (which ignore it) keep working — the real entry point always
  // passes it.
  // Token-waste-reduction plan, Task 1 (2026-08-16): changedFiles/
  // previousFindings are appended at the end, both optional, so every
  // existing stub (which ignores them) keeps compiling unchanged. Computed
  // by runQAFixLoopWithDeps below from THIS round's fix outcomes and the
  // JUST-FAILED round's findings — see computeChangedFiles/
  // extractPreviousFindings. Only ever non-undefined on a round-2+ call
  // (inside the while loop); the initial call before the loop always omits
  // both, preserving round-1's full-explore behavior.
  runStage5: (
    projectId: string,
    stage4Result: Stage4Result,
    plan?: BuildPlan,
    changedFiles?: string[],
    previousFindings?: Stage5RawFindings,
  ) => Promise<Stage5Result>;
  // P3 (agent-autonomy-assessment F3): escalations is optional on the
  // result so existing DI test stubs (which return only {success}) keep
  // compiling unchanged.
  // Token-waste-reduction plan, Task 1: filesWritten is optional so existing
  // stubs (which don't report it) keep compiling unchanged — omitting it is
  // indistinguishable from "this fix touched nothing," which correctly
  // falls back to full-explore next round (the safe default) rather than
  // silently granting a free pass.
  fixShubham: (plan: BuildPlan, findings: string[]) => Promise<{ success: boolean; escalations?: Escalation[]; filesWritten?: string[] }>;
  fixAanya: (plan: BuildPlan, findings: string[]) => Promise<{ success: boolean; escalations?: Escalation[]; filesWritten?: string[] }>;
  // 2026-07-24 (P3.W3.4): Pranav previously had NO fix path at all — a
  // db/-only finding set stopped the loop immediately ("no auto-fix path
  // yet"). Optional (like recordInstincts below) so existing DI tests that
  // predate this fix keep compiling and behaving unchanged; the real entry
  // point wires Pranav's real runFix (expand-contract migration, not a
  // schema rewrite — see agents/generators/pranav/src/index.ts).
  fixPranav?: (plan: BuildPlan, findings: string[]) => Promise<{ success: boolean; filesWritten?: string[] }>;
  // 2026-07-08: Patent Claim 2's instinct memory had a real DB table but
  // nothing ever wrote to it — every pipeline run started with total
  // amnesia. Optional so existing DI tests (which don't care about memory)
  // keep compiling unchanged; the real entry point (runQAFixLoop) wires the
  // actual DB-backed recorder. Called BEFORE the fix, recording "this
  // mistake happened" for the next run's generation prompt to see.
  recordInstincts?: (agentName: string, findings: string[]) => Promise<void>;
  // 2026-10-03 (evidence-only plan): Tilotma settles findings a builder
  // disputed with evidence (see ../disputes.ts). Optional so DI tests that
  // never dispute keep working; the real entry point wires her real run.
  settleDisputes?: SettleFn;
  // 2026-10-04 (progress guard): judges each finished review round; a hold
  // stops the loop before the next round is paid for. Optional so DI tests
  // that don't care keep working; the real entry point wires the real guard.
  roundGuard?: (findings: Finding[]) => Promise<GuardVerdict>;
}

function formatFinding(f: { file: string; issue: string }): string {
  return f.file ? `${f.file}: ${f.issue}` : f.issue;
}

// ── Round-scoped QA re-scan (token-waste-reduction plan, Task 1, 2026-08-16) ─
// Every round after the first re-explored the ENTIRE project from scratch,
// even when a fix pass only touched one or two files — this is where round
// N's generator filesWritten (Shubham/Aanya/Pranav's own return value)
// becomes round N+1's "focus your reads here" signal for Navya/Karan/
// Deepika (stage5-adversarial-qa.ts / qa-loop.ts).
//
// Labels each agent's filesWritten (relative to that agent's OWN output
// dir, e.g. "src/routes/index.ts") to match the SAME "backend/"/"frontend/"/
// "db/" prefix convention QA's labeled dirs use (stage5-adversarial-qa.ts's
// runStage5) — a raw unlabeled path would never match anything a reviewer
// actually reads. Deliberately NOT filesystem mtime — same correctness
// reasoning qa-loop.ts's shared file-read cache already documents: mtime
// resolution can't reliably detect a same-second edit, and filesWritten is
// the generator's own authoritative record of what it touched.
// 2026-09-29 (project a034f90ba50e): success:false does NOT mean the code is
// unchanged — a fixer can write its files, pass the build, then hit its step
// cap while re-checking and never call task_complete. Only a failed fix that
// wrote nothing is known to have left the code as it was.
export function fixChangedCode(outcome: { success: boolean; filesWritten?: string[] }): boolean {
  return outcome.success || (outcome.filesWritten?.length ?? 0) > 0;
}

export function computeChangedFiles(
  fixOutcomes: Array<{ agent: string; filesWritten?: string[] }>,
): string[] {
  const labelFor: Record<string, string> = { shubham: "backend", aanya: "frontend", pranav: "db" };
  const out = new Set<string>();
  for (const outcome of fixOutcomes) {
    const label = labelFor[outcome.agent];
    if (!label) continue;
    for (const f of outcome.filesWritten ?? []) out.add(`${label}/${f}`);
  }
  return [...out];
}

// The round that just failed reported each reviewer's OWN raw findings via
// perAgentFindings (stage5-adversarial-qa.ts) — this is the source for the
// NEXT round's `previousFindings` argument, so a real finding on a file
// nobody re-reads next round isn't silently lost (see qa-loop.ts's
// mergeCarriedForwardFindings, the actual deterministic carry-forward
// mechanism this data feeds). Filters out each reviewer's own "my review
// tooling crashed" meta-findings (review-incomplete / parse-failure /
// Karan's equivalent text) — those describe a QA-tooling failure from THIS
// round, not a confirmed code defect, and must never be mechanically
// re-asserted as if they were. Returns undefined when the round had no
// perAgentFindings at all (e.g. a hand-built Stage5Result in a test/caller
// that predates this field) — the caller treats that the same as "no
// previous findings to carry forward," never as an error.
function isKaranMetaFinding(description: string): boolean {
  return description.includes("review did not complete") || description.includes("could not be parsed as JSON");
}

export function extractPreviousFindings(result: Stage5Result): Stage5RawFindings | undefined {
  const raw = result.perAgentFindings;
  if (!raw) return undefined;
  return {
    navya: raw.navya.filter((f) => f.category !== "review-incomplete" && f.category !== "parse-failure"),
    karan: raw.karan.filter((f) => !isKaranMetaFinding(f.description)),
    deepika: raw.deepika.filter((f) => f.category !== "review-incomplete" && f.category !== "parse-failure"),
  };
}

// 2026-07-12: real bug found live (direct DB query: `SELECT domain,
// count(*) FROM instincts` returned a single row, security|105) — every
// instinct ever recorded was misfiled under domain="security" regardless
// of which QA agent actually found it. stage5-adversarial-qa.ts's
// karanFindingToFinding/navyaFindingToFinding/deepikaFindingToFinding
// already prefix every finding's `issue` string with `[security/...]`,
// `[logic/...]`, or `[performance/...]` — this reads that prefix instead
// of ignoring it. "logic" maps to "architecture" (the closest fit in
// InstinctDomain; there's no dedicated "logic" domain). Falls back to
// "security" for a finding with no recognizable prefix rather than
// throwing — memory is an enrichment, not a hard dependency.
export function inferInstinctDomain(finding: string): InstinctDomain {
  if (finding.startsWith("[security/")) return "security";
  if (finding.startsWith("[performance/")) return "performance";
  if (finding.startsWith("[logic/")) return "architecture";
  return "security";
}

export async function summarizeFindingToInstinctRule(
  finding: string,
  agentName: string,
): Promise<{ trigger: string; action: string }> {
  try {
    const { geminiChat } = await import("@nexsidi/llm-client");
    const prompt = `\
You are a Senior Software Architect.
Analyze the following QA bug finding found in the generated code for agent "${agentName}":
"${finding}"

Summarize this finding into a concise "Instinct Rule" to prevent this mistake from happening again.
Provide exactly two fields:
- TRIGGER: The exact context or code pattern where this mistake happens (e.g., "writing database queries" or "clerk authentication middleware" or "handling date checks"). Maximum 80 characters.
- ACTION: The specific guidance on how to avoid it (e.g., "Do not use string interpolation; always use parameterized queries" or "Ensure the userId is cast to a string to match the Clerk format"). Maximum 150 characters.

Format your output exactly as:
TRIGGER: <summary of trigger>
ACTION: <clean actionable rule>`;

    const chatResponse = await geminiChat([
      { role: "user", content: prompt }
    ]);
    const responseText = chatResponse.content;
    const lines = responseText.split("\n");
    let trigger = finding.slice(0, 80);
    let action = finding.slice(0, 150);
    for (const line of lines) {
      if (line.toUpperCase().startsWith("TRIGGER:")) {
        trigger = line.substring(8).trim();
      } else if (line.toUpperCase().startsWith("ACTION:")) {
        action = line.substring(7).trim();
      }
    }
    return { trigger, action };
  } catch {
    return {
      trigger: finding.slice(0, 80),
      action: finding.slice(0, 150),
    };
  }
}

// 2026-10-03 (evidence-only plan): the text-only debate is gone — it judged a
// finding from its wording alone and once dismissed a real, exactly cited
// route bug. Findings now pass only fact checks: the reviewer's quote must be
// in the file (qa-loop.ts), a claim the source disproves is dropped
// (finding-evidence.ts), and a finding Tilotma ruled not true after a
// builder's dispute is dropped (disputes.ts). A HIGH or CRITICAL finding still
// forces a fix even over a passing score (2026-08-09, meridianbk4: a HIGH
// route bug shipped because the score alone passed).
const PENALTY: Record<string, number> = { CRITICAL: 20, HIGH: 10, MEDIUM: 5, LOW: 1 };
function severityOf(f: Finding): string | undefined {
  return f.issue.match(/\/(CRITICAL|HIGH|MEDIUM|LOW)\]/)?.[1];
}

export function applyEvidenceGate(result: Stage5Result, projectId?: string): Stage5Result {
  if (result.findings.length === 0) return result;
  let findings = result.findings;
  let droppedAny = false;
  if (projectId) {
    const code = dropCodeContradictedFindings(findings, joinPath(process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds", projectId));
    for (const d of code.dropped) console.log(`[qa-fix-loop] dropped finding contradicted by the code (${d.reason}): ${d.finding.file}`);
    const settled = dropSettledNotTrue(projectId, code.kept);
    for (const d of settled.dropped) console.log(`[qa-fix-loop] dropped finding Tilotma ruled not true: ${d.file}: ${d.issue.slice(0, 120)}`);
    findings = settled.kept;
    droppedAny = code.dropped.length + settled.dropped.length > 0;
  }
  const blocking = findings.some((f) => severityOf(f) === "CRITICAL" || severityOf(f) === "HIGH" || f.issue.includes("review-incomplete") || f.issue.includes("review did not complete"));
  if (blocking) return { ...result, findings, pass: false };
  if (!droppedAny) return { ...result, findings };
  const score = 100 - findings.reduce((sum, f) => sum + (PENALTY[severityOf(f) ?? ""] ?? 0), 0);
  return { ...result, findings, pass: score >= 85 };
}

/**
 * Pure orchestration core — DI-testable, no live LLM calls. Runs QA, and on
 * failure, fixes the fault-isolated agent's code and retests, up to
 * MAX_FIX_ITERATIONS times or until stuck-detection fires.
 */
export async function runQAFixLoopWithDeps(
  projectId: string,
  plan: BuildPlan,
  stage4Result: Stage4Result,
  deps: QAFixDeps,
): Promise<QAFixLoopResult> {
  let result = applyEvidenceGate(await deps.runStage5(projectId, stage4Result, plan), projectId);

  let iterations = 1;
  let previousFindingCount = result.findings.length;
  let noImprovementStreak = 0;
  const holdIfNoProgress = async (): Promise<QAFixLoopResult | null> => {
    if (result.pass || result.findings.length === 0 || !deps.roundGuard) return null;
    const verdict = await deps.roundGuard(result.findings);
    return verdict.hold ? { ...result, iterations, stuck: true, hold: { reason: verdict.reason, evidence: verdict.evidence } } : null;
  };
  const heldFirst = await holdIfNoProgress();
  if (heldFirst) return heldFirst;

  while (!result.pass && iterations <= MAX_FIX_ITERATIONS) {
    // 2026-08-10: real bug found live (project freshtst1) — a
    // "review-incomplete" finding (a QA agent's OWN reviewer tooling
    // crashed, e.g. Deepika's fallback-parser failing on malformed model
    // output) has no `file` field, so agentForFile("") falls through to its
    // "shubham" default — same as every other unfileable finding. Shubham
    // was then asked to "fix" a finding whose entire content is "the
    // reviewer's tool crashed," which no code change can address; it
    // recurred identically every round (a QA-tooling reliability issue, not
    // a code defect) and ran the loop all the way to stuck-detection
    // instead of recognizing immediately that nothing routable existed.
    // Filtered out here, before grouping — result.pass and the final
    // findings list (checked further down / returned to the caller) are
    // untouched, so D25's default-FAIL still correctly blocks deployment
    // and the finding is still visible in the report; it just never gets
    // handed to a generator.
    // isKaranMetaFinding catches Karan's differently-worded equivalent
    // ("review did not complete", no hyphen — see its own comment above) —
    // "review-incomplete" alone only matches Navya/Deepika's category text.
    const routableFindings = result.findings.filter(
      (f) => !f.issue.includes("review-incomplete") && !isKaranMetaFinding(f.issue),
    );

    // Real 2026-07-06 stress-test bug: findings can span BOTH backend/ and
    // frontend/ files in the same QA pass. Using only result.faultAgent
    // (identifyFaultAgent's single first-match) fixed one agent every round
    // and permanently ignored the other's findings. Route each agent its OWN
    // subset instead, and fix every implicated agent that has a real fix
    // path (Shubham/Aanya) in the same round.
    const groups = groupFindingsByAgent(routableFindings);
    const shubhamFindings = groups.get("shubham");
    const aanyaFindings = groups.get("aanya");
    const pranavFindings = groups.get("pranav");

    // 2026-07-24 (P3.W3.4): pranav findings now have a real fix path
    // (deps.fixPranav) when the caller wires one — only stop if there is
    // truly nothing that can act on any of the findings this round.
    if (!shubhamFindings && !aanyaFindings && !(pranavFindings && deps.fixPranav)) {
      // Only pranav findings remain and no fixPranav dep was provided
      // (existing DI tests, or a caller that hasn't wired it) — stop
      // rather than loop uselessly (Stage 5 would just return the same
      // result). Once fixPranav is wired, this path is no longer reachable
      // for a pranav-only finding set.
      return { ...result, iterations, stuck: true };
    }

    // 2026-07-26 (autonomy/throughput pass): real root cause found live on
    // nextech10 — fixShubham/fixAanya/fixPranav's own {success} result was
    // discarded entirely. A fix agent that genuinely fails to complete
    // (exhausts its own iteration budget, an unrecoverable model error)
    // leaves the code UNCHANGED; the next QA pass finds the exact same
    // findings, and it took a full STUCK_THRESHOLD worth of wasted QA
    // re-scans (each one 3 full agent passes + peer debate) before the
    // loop gave up — with no way to distinguish "the fix never even ran"
    // from "the fix ran but the issue is genuinely hard." Checking the
    // result closes that gap; running the independent agents' fix rounds
    // via Promise.all (they touch disjoint output directories, same as the
    // initial parallel generation stage) is real wall-clock savings on the
    // common case of findings spanning both backend and frontend.
    const roundStart = new Date().toISOString();
    const fixCalls: Promise<{ agent: string; success: boolean; escalations?: Escalation[]; filesWritten?: string[] }>[] = [];

    if (shubhamFindings) {
      const formatted = shubhamFindings.map(formatFinding);
      fixCalls.push(
        (async () => {
          await deps.recordInstincts?.("shubham", formatted);
          const { success, escalations, filesWritten } = await deps.fixShubham(plan, formatted);
          return { agent: "shubham", success, escalations, filesWritten };
        })(),
      );
    }
    if (aanyaFindings) {
      const formatted = aanyaFindings.map(formatFinding);
      fixCalls.push(
        (async () => {
          await deps.recordInstincts?.("aanya", formatted);
          const { success, escalations, filesWritten } = await deps.fixAanya(plan, formatted);
          return { agent: "aanya", success, escalations, filesWritten };
        })(),
      );
    }
    if (pranavFindings && deps.fixPranav) {
      const formatted = pranavFindings.map(formatFinding);
      fixCalls.push(
        (async () => {
          await deps.recordInstincts?.("pranav", formatted);
          const { success, filesWritten } = await deps.fixPranav!(plan, formatted);
          return { agent: "pranav", success, filesWritten };
        })(),
      );
    }

    const fixOutcomes = await Promise.all(fixCalls);
    const failedAgents = fixOutcomes.filter((o) => !o.success).map((o) => o.agent);
    for (const agent of failedAgents) {
      console.error(
        `[qa-fix-loop] ${agent} fix FAILED to complete — the generator did not resolve its assigned findings this round`,
      );
    }
    // Every implicated fix this round failed outright AND wrote nothing —
    // the code is provably unchanged, so a rescan can only reproduce the
    // exact same findings. Stop now rather than spend a full expensive QA
    // pass confirming what is already known.
    // Decided after disputes are settled (below): a round where the builders
    // changed nothing because they disputed findings is not a dead round.
    const mainFixChangedNothing = fixOutcomes.length > 0 && fixOutcomes.every((o) => !fixChangedCode(o));

    // Token-waste-reduction plan, Task 1: what this round ACTUALLY changed,
    // for the NEXT round's QA dispatch — computed from the main fix round's
    // filesWritten before the escalation block below (which can add more).
    const changedFilesThisRound = new Set(computeChangedFiles(fixOutcomes));

    // P3 (agent-autonomy-assessment F3): a fix agent may have decided the
    // real fix belongs in another agent's domain (escalate_finding) instead
    // of forcing a workaround. Route the escalation to whichever agent
    // actually owns that domain in THIS SAME round — waiting for another QA
    // cycle to notice the same root cause is exactly the wasted-round cost
    // this closes. Dispatched sequentially, after the main round, since it
    // depends on this round's fix outcomes.
    // 2026-08-16: this used to filter for targetAgent === "pranav" only
    // ("currently the only cross-layer target with a real fix path" — but
    // fixShubham/fixAanya were ALREADY real fix paths by then, just never
    // wired here). Root-caused live on fulfillio1: Aanya repeatedly called
    // escalate_finding({target_agent: "shubham", ...}) for a missing
    // GET /api/v1/orders/:id endpoint — the tool call itself succeeds and
    // logs "Escalated to shubham: ...", which looks like it worked, but the
    // escalation was silently dropped here every round because only pranav
    // was ever dispatched. The same finding re-surfaced round after round,
    // burning QA cycles and tripping stuck-detection, while Shubham never
    // once received it as an actual task.
    const escalationsByTarget: Record<"shubham" | "aanya" | "pranav", Escalation[]> = { shubham: [], aanya: [], pranav: [] };
    for (const e of fixOutcomes.flatMap((o) => o.escalations ?? [])) escalationsByTarget[e.targetAgent].push(e);
    const labelForEscalation: Record<"shubham" | "aanya" | "pranav", string> = { shubham: "backend", aanya: "frontend", pranav: "db" };

    for (const target of ["shubham", "aanya", "pranav"] as const) {
      const targeted = escalationsByTarget[target];
      const fixFn = target === "pranav" ? deps.fixPranav : target === "shubham" ? deps.fixShubham : deps.fixAanya;
      if (targeted.length === 0 || !fixFn) continue;
      const formatted = targeted.map((e) => `${e.finding} — ${e.reason}`);
      console.log(`[qa-fix-loop] routing ${formatted.length} escalated finding(s) to ${target} this round`);
      await deps.recordInstincts?.(target, formatted);
      const { success, filesWritten } = await fixFn(plan, formatted);
      // Token-waste-reduction plan, Task 1: an escalation-routed fix writes
      // real files too (outside the main fixCalls/computeChangedFiles pass
      // above) — fold it in so the next round's reviewers know to look here.
      for (const f of filesWritten ?? []) changedFilesThisRound.add(`${labelForEscalation[target]}/${f}`);
      if (!success) {
        console.error(`[qa-fix-loop] ${target} escalation fix FAILED to complete`);
      }
    }

    // 2026-10-03 (evidence-only plan): findings disputed this round go to
    // Tilotma; confirmed ones go back to their builder with her evidence.
    const disputeOutcome = await resolveDisputes(projectId, roundStart, plan, {
      settle: deps.settleDisputes,
      fixers: { shubham: deps.fixShubham, aanya: deps.fixAanya, pranav: deps.fixPranav },
    });
    if (mainFixChangedNothing && disputeOutcome.settledNotTrue === 0 && !disputeOutcome.refixChanged && changedFilesThisRound.size === 0) {
      console.error(`[qa-fix-loop] stopping — every fix this round failed outright and nothing was settled, a rescan would be wasted`);
      return { ...result, iterations, stuck: true };
    }

    // Token-waste-reduction plan, Task 1: an empty changed-files set (a fix
    // round that reported no filesWritten at all — every existing DI test
    // stub, or a genuinely no-op fix) is the deliberate safe default for
    // "fall back to full-explore next round," not a free pass — see
    // qa-loop.ts's QAAgentConfig.changedFilesSinceLastRound comment.
    const changedFiles = changedFilesThisRound.size > 0 ? [...changedFilesThisRound] : undefined;
    const previousFindings = changedFiles ? extractPreviousFindings(result) : undefined;

    result = applyEvidenceGate(await deps.runStage5(projectId, stage4Result, plan, changedFiles, previousFindings), projectId);
    iterations++;
    const held = await holdIfNoProgress();
    if (held) return held;

    const currentFindingCount = result.findings.length;
    if (currentFindingCount >= previousFindingCount) {
      noImprovementStreak++;
      if (noImprovementStreak >= STUCK_THRESHOLD) {
        return { ...result, iterations, stuck: true };
      }
    } else {
      noImprovementStreak = 0;
    }
    previousFindingCount = currentFindingCount;
  }

  return { ...result, iterations, stuck: !result.pass };
}

/** Real entry point — wires the actual Stage 5 + Shubham/Aanya/Pranav fix calls. */
export async function runQAFixLoop(
  projectId: string,
  plan: BuildPlan,
  stage4Result: Stage4Result,
): Promise<QAFixLoopResult> {
  const [{ runFix: fixShubhamReal }, { runFix: fixAanyaReal }, { runFix: fixPranavReal }] = await Promise.all([
    import("../../../agents/generators/shubham/src/index.ts"),
    import("../../../agents/generators/aanya/src/index.ts"),
    // 2026-07-24 (P3.W3.4): real db fault-isolation path — was previously
    // absent entirely (see fixPranav's comment on QAFixDeps above).
    import("../../../agents/generators/pranav/src/index.ts"),
  ]);

  return runQAFixLoopWithDeps(projectId, plan, stage4Result, {
    // includeTier3 stays at its default false — this is the pre-deployment
    // gate, per runStage5's own header comment. Wrapped so plan lands in
    // QAFixDeps.runStage5's 3rd positional slot instead of runStage5's own
    // 3rd slot (includeTier3). changedFiles/previousFindings (Task 1) pass
    // straight through to runStage5's own matching positional slots.
    runStage5: (pid, s4, p, changedFiles, previousFindings) => runStage5(pid, s4, false, p, changedFiles, previousFindings),
    // 2026-08-06: real bug found live (project bae438767bed) — a shared-pool
    // quota exhaustion hitting all three fix calls simultaneously (they run
    // concurrently) used to fail every one of them outright within a
    // handful of iterations, with no retry at all, escalating the whole
    // workflow as "stuck" when the actual findings weren't hard to fix at
    // all. Wrapped with the same quota-aware retry the initial generation
    // path already had (pipeline/activities/index.ts's runShubham/runAanya/
    // runPranav) — see quota-retry.ts's header comment for the full trace.
    fixShubham: async (p, findings) => {
      const r = await runGeneratorWithQuotaRetry(() => fixShubhamReal(p, findings));
      return { success: r.success, escalations: r.escalations, filesWritten: r.filesWritten };
    },
    fixAanya: async (p, findings) => {
      const r = await runGeneratorWithQuotaRetry(() => fixAanyaReal(p, findings));
      return { success: r.success, escalations: r.escalations, filesWritten: r.filesWritten };
    },
    fixPranav: async (p, findings) => {
      const r = await runGeneratorWithQuotaRetry(() => fixPranavReal(p, findings));
      return { success: r.success, filesWritten: r.filesWritten };
    },
    roundGuard: (findings) => checkRoundGuard(projectId, "qa", findings),
    settleDisputes: async (pid, disputes) => {
      const { settleDisputes } = await import("../../../agents/tilotma/src/settle-disputes.ts");
      return settleDisputes(pid, disputes, { reviewRoot: joinPath(process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds", pid) });
    },
    // 2026-07-08: real instinct-memory write path (see packages/db/src/
    // instincts.ts's header comment for why this exists). Each finding
    // becomes its own instinct record — one QA round can surface several
    // distinct mistakes, and collapsing them into one record would lose
    // which specific pattern to warn about next time. Domain is inferred
    // per-finding via inferInstinctDomain (see 2026-07-12 fix above) —
    // previously hardcoded to "security" for every finding regardless of
    // origin, which silently broke queryRecentInstincts("performance")/
    // ("architecture") for Deepika/Navya mistakes forever.
    //
    // BUG FOUND LIVE 2026-07-08 (stress-gemini-primary run): this had no
    // try/catch, unlike the read side (Shubham/Aanya's loadKnownMistakesPrefix)
    // which does. Postgres isn't running in this dev environment —
    // ECONNREFUSED here crashed the ENTIRE pipeline (unhandled rejection
    // propagating out of the QA fix loop) even though the actual generation
    // work (Gemini-primary) had already succeeded. Memory is an enrichment,
    // not a hard dependency — must fail exactly as safely as the read side.
    recordInstincts: async (agentName, findings) => {
      try {
        const { recordInstinct } = await import("@nexsidi/db");
        for (const finding of findings) {
          const summarized = await summarizeFindingToInstinctRule(finding, agentName);
          await recordInstinct(
            agentName,
            inferInstinctDomain(finding),
            summarized.trigger,
            summarized.action,
          );
        }
      } catch (err) {
        console.log(`[qa-fix-loop] recordInstincts failed (non-fatal, memory is an enrichment): ${String(err)}`);
      }
    },
  });
}
