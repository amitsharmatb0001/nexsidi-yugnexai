import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NimToolDef } from "@nexsidi/llm-client";
import type { ToolResult } from "./file.ts";
import { buildDirFor } from "../build-dir.ts";

// P3 (agent-autonomy-assessment F3): findings were routed to a fix agent by
// the FILE PATH a QA agent happened to cite, with no way for that agent to
// say "the actual fix belongs somewhere I can't edit." Live proof this
// mattered: Shubham was told (in prose, in the fix prompt) that a missing
// DB constraint should be reported rather than worked around, but had no
// STRUCTURED way to hand that off — it could only mention it in a
// task_complete summary a human might never read. escalate_finding is that
// structured handoff: a fix agent calls it instead of forcing a
// workaround, and the orchestrator (stage5-qa-fix-loop.ts) can route the
// escalation to the actual owning agent in the SAME round.
export interface Escalation {
  targetAgent: "shubham" | "aanya" | "pranav";
  finding: string;
  reason: string;
}

// Pure — no I/O, just validates and echoes back what gets recorded. The
// caller (loop.ts/gemini-loop.ts) is responsible for pushing the returned
// Escalation onto its own accumulator; this function has no side effects
// so it's trivially testable without a running agent loop.
export function recordEscalation(args: {
  target_agent: string;
  finding: string;
  reason: string;
}): { escalation: Escalation | null; result: ToolResult } {
  const validTargets = ["shubham", "aanya", "pranav"] as const;
  // 2026-10-03 (evidence-only plan): an unknown target used to become
  // "pranav" — a guess about who owns the fix. The agent names the owner.
  if (!validTargets.includes(args.target_agent as never)) {
    return {
      escalation: null,
      result: { status: "error", summary: `Name the owner of the fix: shubham (backend), aanya (frontend) or pranav (database). "${args.target_agent}" is not one of them.` },
    };
  }
  const targetAgent = args.target_agent as Escalation["targetAgent"];

  const escalation: Escalation = { targetAgent, finding: args.finding, reason: args.reason };
  return {
    escalation,
    result: {
      status: "success",
      summary: `Escalated to ${targetAgent}: ${args.reason.slice(0, 100)}`,
    },
  };
}

// 2026-10-30 (team plan, stage 4): the hand-off is also written down, so the acceptance finish check (a fix run may end
// with a failing test only when it disputed the test or handed it on) can see it. <build>/escalations.jsonl.
const escalationsFile = (projectId: string) => join(buildDirFor(projectId), "escalations.jsonl");

export function saveEscalation(projectId: string | undefined, agent: string, e: Escalation): void {
  if (!projectId) return;
  try {
    mkdirSync(buildDirFor(projectId), { recursive: true });
    appendFileSync(escalationsFile(projectId), JSON.stringify({ agent, ...e, at: new Date().toISOString() }) + "\n");
  } catch (err) {
    console.error(`[${agent}] could not save the hand-off: ${String(err)}`);
  }
}

/** Hand-offs recorded for a project, optionally only those at or after `sinceIso`. */
export function readEscalations(projectId: string, sinceIso?: string): Array<Escalation & { agent: string; at: string }> {
  const file = escalationsFile(projectId);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const e = JSON.parse(line) as Escalation & { agent: string; at: string };
        return !sinceIso || e.at >= sinceIso ? [e] : [];
      } catch {
        return [];
      }
    });
}

export const ESCALATE_FINDING_TOOL_DEF: NimToolDef = {
  type: "function",
  function: {
    name: "escalate_finding",
    description:
      "Hand off a QA finding to the agent that actually owns the layer where the real fix belongs (e.g. a missing DB UNIQUE/CHECK constraint that only Pranav can add). Use this INSTEAD of writing an application-layer workaround that can't fully close the gap — do not silently ignore a finding you can't properly fix in your own domain.",
    parameters: {
      type: "object",
      properties: {
        target_agent: { type: "string", enum: ["shubham", "aanya", "pranav"], description: "Which agent owns the layer this fix actually belongs in" },
        finding: { type: "string", description: "The original finding text, verbatim" },
        reason: { type: "string", description: "Why this belongs in target_agent's domain, not yours — be specific (e.g. 'needs UNIQUE(user_id, property_id) on the applications table')" },
      },
      required: ["target_agent", "finding", "reason"],
    },
  },
};
