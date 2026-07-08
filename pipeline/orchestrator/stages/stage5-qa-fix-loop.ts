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
import { groupFindingsByAgent, type Stage4Result } from "./stage4-multi-agent-dev.ts";
import { runStage5, type Stage5Result } from "./stage5-adversarial-qa.ts";

export interface QAFixLoopResult extends Stage5Result {
  iterations: number; // total QA passes run (initial + retests)
  stuck: boolean;      // true if the loop exited via stuck-detection or an unfixable faultAgent, not a pass
}

const MAX_FIX_ITERATIONS = 3; // retest cycles after the initial QA pass
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
}

function formatFinding(f: { file: string; issue: string }): string {
  return f.file ? `${f.file}: ${f.issue}` : f.issue;
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

  return { ...result, iterations, stuck: false };
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
    // 2026-07-08: real instinct-memory write path (see packages/db/src/
    // instincts.ts's header comment for why this exists). Each finding
    // becomes its own instinct record — one QA round can surface several
    // distinct mistakes, and collapsing them into one record would lose
    // which specific pattern to warn about next time. Domain defaults to
    // "security" — in practice the QA fix loop's findings predominantly
    // come from Karan's zero-tolerance security gate (the most common
    // blocker observed this session), not a claim that non-security
    // findings never reach here.
    recordInstincts: async (agentName, findings) => {
      const { recordInstinct } = await import("@nexsidi/db");
      for (const finding of findings) {
        await recordInstinct(agentName, "security", finding.slice(0, 200), finding);
      }
    },
  });
}
