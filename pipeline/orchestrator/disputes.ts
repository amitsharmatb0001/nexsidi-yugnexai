// Disputed findings (evidence-only plan, approved by Amit 3 Oct 2026).
// Ledgerly run 4: a check reported the spec's colours missing from a site
// that showed them, and the frontend builder changed a correct theme to make
// the finding go away. Now a builder confirms each finding first and disputes
// one the facts disprove (dispute_finding). After each fix round the disputes
// go to Tilotma, who checks them herself:
//   - true      → back to the builder, with her evidence, in the same round;
//   - not true  → dropped, kept in <build>/settled-not-true.jsonl so the same
//                 finding is not sent again;
//   - unsettled → stays open; nothing is dropped or assumed.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readDisputes, type Dispute } from "../../packages/agent-runtime/src/tools/dispute.ts";
import type { BuildPlan } from "../../agents/arjun/src/index.ts";

export interface DisputeVerdict {
  dispute: Dispute;
  verdict: "true" | "not_true";
  evidence: string;
}

export type SettleFn = (projectId: string, disputes: Dispute[]) => Promise<DisputeVerdict[]>;
type Owner = "shubham" | "aanya" | "pranav";
type FixFn = (plan: BuildPlan, findings: string[]) => Promise<{ success: boolean; filesWritten?: string[] }>;

interface SettledNotTrue {
  finding: string;
  evidence: string;
  at: string;
}

function settledFile(projectId: string): string {
  return join(process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds", projectId, "settled-not-true.jsonl");
}

function readSettled(projectId: string): SettledNotTrue[] {
  const file = settledFile(projectId);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as SettledNotTrue];
      } catch {
        return [];
      }
    });
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Findings Tilotma already found not true are removed; the rest are kept. Matched on the finding's own text. */
export function dropSettledNotTrue<F extends { file?: string; issue?: string; detail?: string }>(
  projectId: string,
  findings: F[],
): { kept: F[]; dropped: F[] } {
  const settled = readSettled(projectId).map((s) => squash(s.finding));
  if (settled.length === 0) return { kept: findings, dropped: [] };
  const kept: F[] = [];
  const dropped: F[] = [];
  for (const f of findings) {
    const text = f.issue ?? f.detail ?? "";
    const key = squash(f.file ? `${f.file}: ${text}` : text);
    (settled.includes(key) ? dropped : kept).push(f);
  }
  return { kept, dropped };
}

export async function resolveDisputes(
  projectId: string,
  sinceIso: string,
  plan: BuildPlan,
  deps: { settle?: SettleFn; fixers: Partial<Record<Owner, FixFn>> },
): Promise<{ disputed: number; settledNotTrue: number; refixChanged: boolean }> {
  const disputes = readDisputes(projectId, sinceIso);
  if (disputes.length === 0) return { disputed: 0, settledNotTrue: 0, refixChanged: false };
  if (!deps.settle) {
    console.warn(`[disputes] ${disputes.length} dispute(s) and nobody to settle them — the findings stay open`);
    return { disputed: disputes.length, settledNotTrue: 0, refixChanged: false };
  }
  console.log(`[disputes] ${disputes.length} finding(s) disputed this round — Tilotma is checking them`);
  const verdicts = await deps.settle(projectId, disputes);
  const unsettled = disputes.length - verdicts.length;
  if (unsettled > 0) console.warn(`[disputes] ${unsettled} dispute(s) not settled — those findings stay open`);

  let settledNotTrue = 0;
  const confirmed: Partial<Record<Owner, string[]>> = {};
  for (const v of verdicts) {
    if (v.verdict === "not_true") {
      settledNotTrue++;
      const file = settledFile(projectId);
      mkdirSync(join(file, ".."), { recursive: true });
      appendFileSync(file, JSON.stringify({ finding: v.dispute.finding, evidence: v.evidence, at: new Date().toISOString() }) + "\n");
      console.log(`[disputes] not true, dropped: ${v.dispute.finding.slice(0, 160)}`);
    } else {
      const owner = v.dispute.agent as Owner;
      (confirmed[owner] ??= []).push(
        `Tilotma checked your dispute and this finding IS true — fix it: ${v.dispute.finding}\nHer evidence: ${v.evidence}`,
      );
    }
  }

  let refixChanged = false;
  for (const [owner, findings] of Object.entries(confirmed) as Array<[Owner, string[]]>) {
    const fix = deps.fixers[owner];
    if (!fix) continue;
    console.log(`[disputes] ${findings.length} confirmed finding(s) back to ${owner}`);
    const r = await fix(plan, findings);
    if ((r.filesWritten ?? []).length > 0) refixChanged = true;
  }
  return { disputed: disputes.length, settledNotTrue, refixChanged };
}
