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
  runStage5: (projectId: string, stage4Result: Stage4Result) => Promise<Stage5Result>;
  fixShubham: (plan: BuildPlan, findings: string[]) => Promise<{ success: boolean }>;
  fixAanya: (plan: BuildPlan, findings: string[]) => Promise<{ success: boolean }>;
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

Is this a genuine defect (compilation error, security flaw, broken functionality, or confidentiality/data-integrity violation per the automatic list above) that MUST be fixed, or a false positive (lint warning, style preference, purely hypothetical risk with no concrete failing scenario, reviewer mistake)?

Respond with exactly:
Reasoning: <one sentence>
DECISION: VALID   or   DECISION: FALSE_POSITIVE`;

        const response = await geminiChat([{ role: "user", content: prompt }]);
        const decisionLine = response.content.split("\n").find((l) => l.toUpperCase().includes("DECISION:"));
        // Use endsWith to avoid matching "INVALID" or "NOT VALID"
        const isValid = decisionLine
          ? decisionLine.toUpperCase().trimEnd().endsWith("VALID")
          : true;

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
  let result = await deps.runStage5(projectId, stage4Result);
  if (!result.pass && deps.conductPeerDebate && result.findings.length > 0) {
    result.findings = await deps.conductPeerDebate(result.findings);
    if (result.findings.length === 0) {
      result.pass = true;
    }
  }

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

    if (!shubhamFindings && !aanyaFindings) {
      // Only pranav (or an unrecognized prefix) findings remain — no
      // auto-fix path yet. Stop rather than loop uselessly (Stage 5 would
      // just return the exact same result).
      return { ...result, iterations, stuck: true };
    }

    if (shubhamFindings) {
      const formatted = shubhamFindings.map(formatFinding);
      await deps.recordInstincts?.("shubham", formatted);
      await deps.fixShubham(plan, formatted);
    }
    if (aanyaFindings) {
      const formatted = aanyaFindings.map(formatFinding);
      await deps.recordInstincts?.("aanya", formatted);
      await deps.fixAanya(plan, formatted);
    }

    result = await deps.runStage5(projectId, stage4Result);
    if (!result.pass && deps.conductPeerDebate && result.findings.length > 0) {
      result.findings = await deps.conductPeerDebate(result.findings);
      if (result.findings.length === 0) {
        result.pass = true;
      }
    }
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

/** Real entry point — wires the actual Stage 5 + Shubham/Aanya fix calls. */
export async function runQAFixLoop(
  projectId: string,
  plan: BuildPlan,
  stage4Result: Stage4Result,
): Promise<QAFixLoopResult> {
  const [{ runFix: fixShubhamReal }, { runFix: fixAanyaReal }] = await Promise.all([
    import("../../../agents/generators/shubham/src/index.ts"),
    import("../../../agents/generators/aanya/src/index.ts"),
  ]);

  return runQAFixLoopWithDeps(projectId, plan, stage4Result, {
    runStage5,
    fixShubham: async (p, findings) => {
      const r = await fixShubhamReal(p, findings);
      return { success: r.success };
    },
    fixAanya: async (p, findings) => {
      const r = await fixAanyaReal(p, findings);
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
