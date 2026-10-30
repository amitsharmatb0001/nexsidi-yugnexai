// report_blocked — how an agent says "I cannot get what I need" (approved
// by Amit, 2 Oct 2026). Ledgerly benchmark run 2: the frontend builder could
// not reach the backend, had no way to ask anyone, and improvised for 42
// steps. Now every agent, in every stage, reports to Tilotma and carries on
// with its own work. Reports are kept in <build>/blockers.jsonl; Tilotma's
// live review checks each one on the running app and routes what it finds
// to the owner through the normal fix loop.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { NimToolDef } from "@nexsidi/llm-client";
import type { ToolResult } from "./file.ts";
import { buildDirFor } from "../build-dir.ts";

export const BLOCKED_OWNERS = ["shubham", "aanya", "pranav", "riya", "tilotma"] as const;
export type BlockedOwner = (typeof BLOCKED_OWNERS)[number];

export interface BlockedReport {
  agent: string;
  owner: BlockedOwner;
  what: string;
  checked: string;
  at: string;
}

function buildRoot(projectId: string): string {
  return buildDirFor(projectId);
}

export function blockersFile(projectId: string): string {
  return join(buildRoot(projectId), "blockers.jsonl");
}

export function recordBlocked(
  projectId: string | undefined,
  agentName: string,
  args: { owner?: string; what?: string; checked?: string },
): ToolResult {
  const owner = (BLOCKED_OWNERS as readonly string[]).includes(args.owner ?? "") ? (args.owner as BlockedOwner) : "tilotma";
  const report: BlockedReport = {
    agent: agentName,
    owner,
    what: String(args.what ?? "").slice(0, 1000),
    checked: String(args.checked ?? "").slice(0, 1000),
    at: new Date().toISOString(),
  };
  if (projectId) {
    try {
      mkdirSync(buildRoot(projectId), { recursive: true });
      appendFileSync(blockersFile(projectId), JSON.stringify(report) + "\n");
    } catch (err) {
      console.error(`[${agentName}] could not save the blocked report: ${String(err)}`);
    }
  }
  console.log(`[blocked] ${agentName} -> ${owner}: ${report.what.slice(0, 200)}`);
  return {
    status: "success",
    summary:
      "Reported to Tilotma. Paid work stops until it is decided: the owner fixes it, you get the answer, or a person decides. " +
      "Do not work around it and do not touch another agent's work — continue with the rest of your own task.",
  };
}

export function readBlockedReports(projectId: string): BlockedReport[] {
  const file = blockersFile(projectId);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as BlockedReport];
      } catch {
        return [];
      }
    });
}

// 2026-10-30 (Amit: "the owner can't do the edit — why did nobody flag it"): a report used to be read only by the final live
// review, so none of Brewline 3's 13 stopped a round. Every report now gets a decision (pipeline/orchestrator/blockers.ts),
// kept in <build>/blocker-rulings.jsonl; a report without one is open, and an open report stops paid work.
export function blockerId(b: BlockedReport): string {
  return createHash("sha256").update(`${b.agent}|${b.at}|${b.what}`).digest("hex").slice(0, 16);
}

export interface BlockerRuling {
  id: string;
  agent: string;
  kind: "route" | "answer" | "customer" | "person";
  detail: string;
  /** the facts the decision stands on: paths and owners (pipeline/orchestrator/blockers.ts) */
  factsKey: string;
  at: string;
}

const rulingsFile = (projectId: string) => join(buildRoot(projectId), "blocker-rulings.jsonl");

export function readBlockerRulings(projectId: string): BlockerRuling[] {
  const file = rulingsFile(projectId);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8").split(/\r?\n/).filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l) as BlockerRuling];
    } catch {
      return [];
    }
  });
}

export function recordBlockerRuling(projectId: string, ruling: BlockerRuling): void {
  mkdirSync(buildRoot(projectId), { recursive: true });
  appendFileSync(rulingsFile(projectId), JSON.stringify(ruling) + "\n");
}

/** Reports with no decision yet. */
export function openBlockers(projectId: string): BlockedReport[] {
  const ruled = new Set(readBlockerRulings(projectId).map((r) => r.id));
  return readBlockedReports(projectId).filter((b) => !ruled.has(blockerId(b)));
}

export const REPORT_BLOCKED_TOOL_DEF: NimToolDef = {
  type: "function",
  function: {
    name: "report_blocked",
    description:
      "Report that you cannot get something you need because it belongs to another agent or is not available yet (a service not running, another folder, missing data). Tilotma checks it and routes it to the owner. After reporting, continue with your own task — never work around it or change another agent's work.",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string", enum: [...BLOCKED_OWNERS], description: "Who owns what you need: shubham (backend), aanya (frontend), pranav (database), riya (deployment), tilotma (anything else)" },
        what: { type: "string", description: "What you need and could not get, and what it blocks in your own work" },
        checked: { type: "string", description: "What you checked, once, that shows it is missing (the tool and its result)" },
      },
      required: ["owner", "what", "checked"],
    },
  },
};
