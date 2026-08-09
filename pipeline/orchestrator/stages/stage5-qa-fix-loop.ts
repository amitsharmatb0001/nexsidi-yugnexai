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
import { runStage5, type Stage5Result } from "./stage5-adversarial-qa.ts";
import type { InstinctDomain } from "@nexsidi/db";
import type { Escalation } from "../../../packages/agent-runtime/src/tools/escalate.ts";
import { runGeneratorWithQuotaRetry } from "../../activities/quota-retry.ts";

export interface QAFixLoopResult extends Stage5Result {
  iterations: number; // total QA passes run (initial + retests)
  stuck: boolean;      // true if the loop exited via stuck-detection or an unfixable faultAgent, not a pass
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
  runStage5: (projectId: string, stage4Result: Stage4Result, plan?: BuildPlan) => Promise<Stage5Result>;
  // P3 (agent-autonomy-assessment F3): escalations is optional on the
  // result so existing DI test stubs (which return only {success}) keep
  // compiling unchanged.
  fixShubham: (plan: BuildPlan, findings: string[]) => Promise<{ success: boolean; escalations?: Escalation[] }>;
  fixAanya: (plan: BuildPlan, findings: string[]) => Promise<{ success: boolean; escalations?: Escalation[] }>;
  // 2026-07-24 (P3.W3.4): Pranav previously had NO fix path at all — a
  // db/-only finding set stopped the loop immediately ("no auto-fix path
  // yet"). Optional (like recordInstincts below) so existing DI tests that
  // predate this fix keep compiling and behaving unchanged; the real entry
  // point wires Pranav's real runFix (expand-contract migration, not a
  // schema rewrite — see agents/generators/pranav/src/index.ts).
  fixPranav?: (plan: BuildPlan, findings: string[]) => Promise<{ success: boolean }>;
  // 2026-07-08: Patent Claim 2's instinct memory had a real DB table but
  // nothing ever wrote to it — every pipeline run started with total
  // amnesia. Optional so existing DI tests (which don't care about memory)
  // keep compiling unchanged; the real entry point (runQAFixLoop) wires the
  // actual DB-backed recorder. Called BEFORE the fix, recording "this
  // mistake happened" for the next run's generation prompt to see.
  recordInstincts?: (agentName: string, findings: string[]) => Promise<void>;
  conductPeerDebate?: (findings: Finding[]) => Promise<Finding[]>;
}

function formatFinding(f: { file: string; issue: string }): string {
  return f.file ? `${f.file}: ${f.issue}` : f.issue;
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

// 2026-08-04 (live, final838491): real bug found live — Navya precisely
// identified a route-mounting mismatch (backend/src/routes/index.ts using
// "/inquiry" instead of the contracted "/inquiries") that caused a genuine
// 404 on every inquiry submission, confirmed by walking the deployed app.
// Peer-debate dismissed it as a false positive and it shipped unfixed.
// Tracing why surfaced a second, independent, purely mechanical bug in THIS
// function: the old inline check `decisionLine.endsWith("VALID")` was meant
// to reject "DECISION: INVALID" (per its own comment) but "INVALID" itself
// ends with the substring "VALID" (I-N-VALID) — the exact opposite of the
// stated intent. Extracted to a pure function so this class of bug is
// caught by a fast unit test instead of only being discoverable by manually
// walking a live deployed app.
export function parseDebateDecision(responseContent: string): boolean {
  const decisionLine = responseContent.split("\n").find((l) => l.toUpperCase().includes("DECISION:"));
  if (!decisionLine) return true; // no parseable verdict — safe direction is to keep the finding

  // Extract just the token(s) after "DECISION:" rather than substring-matching
  // the whole line — "INVALID" contains "VALID" as a substring, so the old
  // `line.endsWith("VALID")` check silently treated a rejection as an
  // approval, the exact opposite of its own stated intent.
  const verdict = decisionLine.toUpperCase().split("DECISION:")[1]?.trim() ?? "";
  if (verdict.startsWith("FALSE_POSITIVE") || verdict.startsWith("INVALID")) return false;
  if (verdict.startsWith("VALID")) return true;
  return true; // unrecognized verdict text — safe direction is to keep the finding
}

export async function conductPeerDebateReal(findings: Finding[]): Promise<Finding[]> {
  if (findings.length === 0) return [];

  const { geminiChat } = await import("@nexsidi/llm-client");

  const results = await Promise.all(
    findings.map(async (f) => {
      // CRITICAL findings bypass debate entirely. The QA agent already applied
      // the evidence rule before marking something CRITICAL — debating confirmed
      // critical defects defeats the purpose of the severity tier and risks
      // silently dropping blocking issues. The debate filter exists to remove
      // hypothetical/unsubstantiated findings (HIGH/MEDIUM/LOW), not to
      // second-guess a confirmed CRITICAL verdict.
      const isCritical = f.issue.includes("/CRITICAL]");
      if (isCritical) {
        console.log(`[debate] Auto-approved CRITICAL (no debate needed): "${f.issue.slice(0, 120)}" in ${f.file}`);
        return f;
      }

      try {
        const prompt = `\
You are Tilotma, the senior QA Moderator for NexSidi.
A QA agent reported this finding:
File: ${f.file}
Issue: ${f.issue}

AUTOMATIC VALID — classify as VALID without further analysis if any of these match:
- The issue mentions "NexSidi", "NexUI", or "@yugnex" appearing in user-facing text (footer, navbar, badge, etc.). This is a confidentiality defect, never a style preference.
- The issue mentions a raw ISO date string (like "2026-07-13") rendered directly in the UI where a human-readable format is expected.
- The issue mentions a status badge ("Connected", "Online") that never reflects actual runtime state.

AUTOMATIC VALID — also classify as VALID without further analysis if the finding cites
SPECIFIC, CHECKABLE facts you could verify by opening the named file yourself (an exact
line number, an exact string/path/route being compared against another exact string/
path/route, an exact field name). You cannot open the file from here — you are judging
plausibility, not re-deriving the answer — so treat a finding this concrete as PROVEN
unless the finding's OWN text is internally contradictory. Dismissing a specific,
mechanically-verifiable claim as "hypothetical" is a real, confirmed failure mode: a QA
agent once precisely identified a route mounted as "/inquiry" instead of the contracted
"/inquiries" (exact file, exact line, exact mismatched strings) — debate dismissed it as
a false positive, and it shipped, causing a genuine 404 on every real user's request.
Reserve FALSE_POSITIVE for findings that are vague, purely hypothetical ("could
theoretically cause issues at scale" with no concrete trigger), a style/lint preference,
or contradicted by the finding's own description.

Is this a genuine defect (compilation error, security flaw, broken functionality, or
confidentiality/data-integrity violation per the automatic lists above) that MUST be
fixed, or a false positive (lint warning, style preference, purely hypothetical risk with
no concrete failing scenario, reviewer mistake)?

Respond with exactly:
Reasoning: <one sentence>
DECISION: VALID   or   DECISION: FALSE_POSITIVE`;

        const response = await geminiChat([{ role: "user", content: prompt }]);
        const isValid = parseDebateDecision(response.content);

        if (isValid) {
          console.log(`[debate] Approved: "${f.issue}" in ${f.file}`);
        } else {
          console.log(`[debate] Dropped false positive: "${f.issue}" in ${f.file}`);
        }
        return isValid ? f : null;
      } catch {
        return f; // on error, keep the finding (safe direction)
      }
    }),
  );

  return results.filter((f): f is Finding => f !== null);
}

// 2026-08-09: real bug found live (project meridianbk4) — both debate call
// sites used to gate on `!result.pass`. A single HIGH finding makes an
// agent's own severity-weighted score pass (100-10=90 >= 85), so
// result.pass was already true and debate never ran at all — even though
// debate exists specifically to independently verify findings like this
// (conductPeerDebateReal's own prompt has a hardcoded guardrail citing an
// earlier near-identical route-mismatch dismissal). Confirmed live: Navya
// precisely identified a route mount mismatch ("/appointment" instead of
// the contracted "/appointments") that 404s every booking request — scored
// HIGH, the aggregate technically "passed", and it shipped broken because
// debate never got a look. Debate now runs whenever there ARE findings,
// regardless of the aggregate verdict, and a debate-CONFIRMED
// CRITICAL/HIGH finding forces pass=false even over an already-passing
// score. A confirmed MEDIUM/LOW finding does NOT override pass — tolerating
// that is the entire point of the >=85 threshold, not a gap to close.
async function applyDebateVerdict(result: Stage5Result, deps: QAFixDeps): Promise<Stage5Result> {
  if (!deps.conductPeerDebate || result.findings.length === 0) return result;
  const debated = await deps.conductPeerDebate(result.findings);
  if (debated.length === 0) {
    return { ...result, findings: debated, pass: true };
  }
  const hasBlockingFinding = debated.some((f) => f.issue.includes("/CRITICAL]") || f.issue.includes("/HIGH]"));
  return { ...result, findings: debated, pass: hasBlockingFinding ? false : result.pass };
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
  let result = await applyDebateVerdict(await deps.runStage5(projectId, stage4Result, plan), deps);

  let iterations = 1;
  let previousFindingCount = result.findings.length;
  let noImprovementStreak = 0;

  while (!result.pass && iterations <= MAX_FIX_ITERATIONS) {
    // Real 2026-07-06 stress-test bug: findings can span BOTH backend/ and
    // frontend/ files in the same QA pass. Using only result.faultAgent
    // (identifyFaultAgent's single first-match) fixed one agent every round
    // and permanently ignored the other's findings. Route each agent its OWN
    // subset instead, and fix every implicated agent that has a real fix
    // path (Shubham/Aanya) in the same round.
    const groups = groupFindingsByAgent(result.findings);
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
    const fixCalls: Promise<{ agent: string; success: boolean; escalations?: Escalation[] }>[] = [];

    if (shubhamFindings) {
      const formatted = shubhamFindings.map(formatFinding);
      fixCalls.push(
        (async () => {
          await deps.recordInstincts?.("shubham", formatted);
          const { success, escalations } = await deps.fixShubham(plan, formatted);
          return { agent: "shubham", success, escalations };
        })(),
      );
    }
    if (aanyaFindings) {
      const formatted = aanyaFindings.map(formatFinding);
      fixCalls.push(
        (async () => {
          await deps.recordInstincts?.("aanya", formatted);
          const { success, escalations } = await deps.fixAanya(plan, formatted);
          return { agent: "aanya", success, escalations };
        })(),
      );
    }
    if (pranavFindings && deps.fixPranav) {
      const formatted = pranavFindings.map(formatFinding);
      fixCalls.push(
        (async () => {
          await deps.recordInstincts?.("pranav", formatted);
          const { success } = await deps.fixPranav!(plan, formatted);
          return { agent: "pranav", success };
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
    // Every implicated fix this round is KNOWN to have failed outright —
    // the code is provably unchanged, so a rescan can only reproduce the
    // exact same findings. Stop now rather than spend a full expensive QA
    // pass confirming what is already known.
    if (fixOutcomes.length > 0 && failedAgents.length === fixOutcomes.length) {
      console.error(`[qa-fix-loop] stopping — every fix this round failed outright, a rescan would be wasted`);
      return { ...result, iterations, stuck: true };
    }

    // P3 (agent-autonomy-assessment F3): a fix agent may have decided the
    // real fix belongs in another agent's domain (escalate_finding) instead
    // of forcing a workaround. Route escalations to pranav (currently the
    // only cross-layer target with a real fix path) in THIS SAME round —
    // waiting for another QA cycle to notice the same root cause is exactly
    // the wasted-round cost this closes. Dispatched sequentially, after the
    // main round, since it depends on this round's fix outcomes.
    const pranavEscalations = fixOutcomes.flatMap((o) => o.escalations ?? []).filter((e) => e.targetAgent === "pranav");
    if (pranavEscalations.length > 0 && deps.fixPranav) {
      const formatted = pranavEscalations.map((e) => `${e.finding} — ${e.reason}`);
      console.log(`[qa-fix-loop] routing ${formatted.length} escalated finding(s) to pranav this round`);
      await deps.recordInstincts?.("pranav", formatted);
      const { success } = await deps.fixPranav(plan, formatted);
      if (!success) {
        console.error(`[qa-fix-loop] pranav escalation fix FAILED to complete`);
      }
    }

    result = await applyDebateVerdict(await deps.runStage5(projectId, stage4Result, plan), deps);
    iterations++;

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
    // 3rd slot (includeTier3).
    runStage5: (pid, s4, p) => runStage5(pid, s4, false, p),
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
      return { success: r.success, escalations: r.escalations };
    },
    fixAanya: async (p, findings) => {
      const r = await runGeneratorWithQuotaRetry(() => fixAanyaReal(p, findings));
      return { success: r.success, escalations: r.escalations };
    },
    fixPranav: async (p, findings) => {
      const r = await runGeneratorWithQuotaRetry(() => fixPranavReal(p, findings));
      return { success: r.success };
    },
    conductPeerDebate: conductPeerDebateReal,
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
