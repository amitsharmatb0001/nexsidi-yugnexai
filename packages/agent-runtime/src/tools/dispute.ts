// dispute_finding — how a builder says "this finding is not true", with the
// facts (evidence-only plan, approved by Amit 3 Oct 2026). Ledgerly run 4:
// the frontend builder was told the spec's colours were missing from the
// live site, saw them in its own theme, and changed the theme anyway — it had
// no way to say the finding was wrong. A builder now confirms each finding
// before fixing it; when the facts say it is wrong, it records a dispute with
// what it checked and what it saw, and changes nothing for it. Disputes are
// kept in <build>/disputes.jsonl; Tilotma settles each one with her own tools.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NimToolDef } from "@nexsidi/llm-client";
import type { ToolResult } from "./file.ts";

export interface Dispute {
  agent: string;
  finding: string;
  checked: string;
  observed: string;
  at: string;
}

function buildRoot(projectId: string): string {
  return join(process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds", projectId);
}

export function disputesFile(projectId: string): string {
  return join(buildRoot(projectId), "disputes.jsonl");
}

export function recordDispute(
  projectId: string | undefined,
  agentName: string,
  args: { finding?: string; checked?: string; observed?: string },
): ToolResult {
  const finding = String(args.finding ?? "").trim();
  const checked = String(args.checked ?? "").trim();
  const observed = String(args.observed ?? "").trim();
  if (!finding || !checked || !observed) {
    return {
      status: "error",
      summary: "A dispute needs the finding, what you checked (the tool and what you ran) and what you saw. Check the finding first; if it holds, fix it instead.",
    };
  }
  const dispute: Dispute = {
    agent: agentName,
    finding: finding.slice(0, 2000),
    checked: checked.slice(0, 2000),
    observed: observed.slice(0, 2000),
    at: new Date().toISOString(),
  };
  if (projectId) {
    try {
      mkdirSync(buildRoot(projectId), { recursive: true });
      appendFileSync(disputesFile(projectId), JSON.stringify(dispute) + "\n");
    } catch (err) {
      console.error(`[${agentName}] could not save the dispute: ${String(err)}`);
    }
  }
  console.log(`[dispute] ${agentName}: ${dispute.finding.slice(0, 200)}`);
  return {
    status: "success",
    summary: "Recorded. Tilotma will check it herself. Do not change code for this finding; carry on with the others.",
  };
}

/** Disputes recorded for a project, optionally only those at or after `sinceIso`. */
export function readDisputes(projectId: string, sinceIso?: string): Dispute[] {
  const file = disputesFile(projectId);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const d = JSON.parse(line) as Dispute;
        return !sinceIso || d.at >= sinceIso ? [d] : [];
      } catch {
        return [];
      }
    });
}

export const DISPUTE_FINDING_TOOL_DEF: NimToolDef = {
  type: "function",
  function: {
    name: "dispute_finding",
    description:
      "Use when you checked a finding and the facts show it is not true (the code, the running app, the build output or the spec say otherwise). Do not change code for a disputed finding. Tilotma checks it herself and decides. Only dispute after checking — never because a fix looks hard.",
    parameters: {
      type: "object",
      properties: {
        finding: { type: "string", description: "The finding, word for word" },
        checked: { type: "string", description: "What you checked to test it: the files you read, the requests or commands you ran" },
        observed: { type: "string", description: "What you saw that shows it is not true — quote the code, the response or the output" },
      },
      required: ["finding", "checked", "observed"],
    },
  },
};
