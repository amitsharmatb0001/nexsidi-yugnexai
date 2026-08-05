import type { NimToolDef } from "@nexsidi/llm-client";
import type { ToolResult } from "./file.ts";

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
}): { escalation: Escalation; result: ToolResult } {
  const validTargets = ["shubham", "aanya", "pranav"] as const;
  const targetAgent = validTargets.includes(args.target_agent as any)
    ? (args.target_agent as Escalation["targetAgent"])
    : "pranav"; // most escalations are "this needs a schema change" — safe default over silently dropping

  const escalation: Escalation = { targetAgent, finding: args.finding, reason: args.reason };
  return {
    escalation,
    result: {
      status: "success",
      summary: `Escalated to ${targetAgent}: ${args.reason.slice(0, 100)}`,
    },
  };
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
