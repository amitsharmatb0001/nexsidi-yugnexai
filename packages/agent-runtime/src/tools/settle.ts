// settle_dispute — Tilotma's verdict on a disputed finding (evidence-only
// plan, approved by Amit 3 Oct 2026). A builder disputes a finding with what
// it checked and saw (tools/dispute.ts); Tilotma, the only agent that sees the
// whole project, checks it herself — code, running app, database — and records
// whether the finding is true, with the evidence. Kept in
// <build>/dispute-verdicts.jsonl. A dispute she does not settle stays open:
// the finding is neither dropped nor assumed.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NimToolDef } from "@nexsidi/llm-client";
import type { ToolResult } from "./file.ts";

export interface Verdict {
  number: number;
  verdict: "true" | "not_true";
  evidence: string;
  at: string;
}

function buildRoot(projectId: string): string {
  return join(process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds", projectId);
}

export function verdictsFile(projectId: string): string {
  return join(buildRoot(projectId), "dispute-verdicts.jsonl");
}

export function recordVerdict(
  projectId: string | undefined,
  args: { number?: number; verdict?: string; evidence?: string },
): ToolResult {
  const number = Number(args.number);
  const evidence = String(args.evidence ?? "").trim();
  if (!Number.isInteger(number) || number < 1) return { status: "error", summary: "Give the dispute's number from the list." };
  if (args.verdict !== "true" && args.verdict !== "not_true") return { status: "error", summary: 'The verdict is "true" (the finding holds) or "not_true".' };
  if (!evidence) return { status: "error", summary: "Give the evidence you checked yourself: the code, the response or the page that decides it." };
  const v: Verdict = { number, verdict: args.verdict, evidence: evidence.slice(0, 2000), at: new Date().toISOString() };
  if (projectId) {
    try {
      mkdirSync(buildRoot(projectId), { recursive: true });
      appendFileSync(verdictsFile(projectId), JSON.stringify(v) + "\n");
    } catch (err) {
      console.error(`[tilotma] could not save the verdict: ${String(err)}`);
    }
  }
  console.log(`[settle] dispute ${number}: ${v.verdict} — ${v.evidence.slice(0, 200)}`);
  return { status: "success", summary: `Dispute ${number} settled as ${v.verdict}.` };
}

export function readVerdicts(projectId: string, sinceIso?: string): Verdict[] {
  const file = verdictsFile(projectId);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const v = JSON.parse(line) as Verdict;
        return !sinceIso || v.at >= sinceIso ? [v] : [];
      } catch {
        return [];
      }
    });
}

export const SETTLE_DISPUTE_TOOL_DEF: NimToolDef = {
  type: "function",
  function: {
    name: "settle_dispute",
    description:
      "Record your verdict on one disputed finding, after checking it yourself. \"true\" means the finding holds and goes back to the builder with your evidence; \"not_true\" means it is dropped. Evidence is what you saw: quote the code, the response or the page.",
    parameters: {
      type: "object",
      properties: {
        number: { type: "integer", description: "The dispute's number in the list you were given" },
        verdict: { type: "string", enum: ["true", "not_true"] },
        evidence: { type: "string", description: "What you checked and saw that decides it" },
      },
      required: ["number", "verdict", "evidence"],
    },
  },
};
