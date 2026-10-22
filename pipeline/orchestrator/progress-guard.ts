// Progress guard (approved by Amit, 4 Oct 2026). Ledgerly run 4 overnight: the
// same false finding came back round after round and the system kept paying
// for new rounds. Rule: work that is not making progress is HELD and reported
// to the developer — no dollar goes to a round that can only repeat itself.
// Deterministic: no model calls, so the guard itself costs nothing.
//
// Every review round in a fix loop is recorded (<build>/rounds.jsonl) with the
// findings it ended on and the project's total spend at that moment. A round
// is judged against the rounds before it, across reruns of the stage:
//   1. REPEAT — a finding that was already open in an earlier round of the
//      same stage came back after builders worked on it. Either the fix did not
//      work or the finding is false and nobody disputed it; a paid retry cannot
//      tell which, a person (or a dispute) must.
//   2. COST WITHOUT PROGRESS — the round cost more than the round cap and the
//      number of open findings did not go down.
// A hold writes <build>/HOLD.md (what happened, the evidence, the spend, the
// options), gives Tilotma the same evidence in her ledger, and the workflow
// stops and asks the developer (guard_hold).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordBlocked } from "../../packages/agent-runtime/src/tools/blocked.ts";
import { buildDirFor } from "../../packages/agent-runtime/src/build-dir.ts";
import { alternativesSection, readAttempts } from "./strategies.ts";

export type RoundStage = "qa" | "live";

export interface RoundRecord {
  at: string;
  stage: RoundStage;
  findings: string[]; // normalized keys
  spendUsd: number; // the project's total spend when the round ended
  /** A marker written when the owner sends Retry after a hold: rounds before it are not compared with rounds after it. */
  reset?: boolean;
}

/** Rounds of a stage since the owner's last Retry (2026-10-22: Retry re-ran the review before any fix and held again). */
function sinceLastRetry(history: RoundRecord[], stage: RoundStage): RoundRecord[] {
  let last = -1;
  history.forEach((h, i) => { if (h.reset) last = i; });
  return history.slice(last + 1).filter((h) => h.stage === stage && !h.reset);
}

export type GuardVerdict = { hold: false } | { hold: true; reason: string; evidence: string[] };

export interface GuardOptions {
  roundSpendCapUsd: number;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** A finding's identity: file + text, with ids and spacing removed. */
export function findingKey(f: { file?: string; issue?: string; detail?: string }): string {
  const text = String(f.issue ?? f.detail ?? "").replace(UUID, "<id>").replace(/\s+/g, " ").trim().toLowerCase();
  return `${(f.file ?? "").trim().toLowerCase()}|${text}`;
}

/** A round's cap is a setting, not a guess: ROUND_SPEND_CAP_USD, default $8 (one round of reviews + fixes). */
export function resolveRoundSpendCapUsd(): number {
  const n = Number(process.env.ROUND_SPEND_CAP_USD?.trim());
  return Number.isFinite(n) && n > 0 ? n : 8;
}

const readable = (key: string) => key.replace(/^\|/, "");

export function judgeRound(history: RoundRecord[], round: RoundRecord, opts: GuardOptions): GuardVerdict {
  const earlier = sinceLastRetry(history, round.stage);
  if (earlier.length === 0) return { hold: false };

  const seen = new Set(earlier.flatMap((h) => h.findings));
  const repeated = round.findings.filter((k) => seen.has(k));
  if (repeated.length > 0) {
    return {
      hold: true,
      reason: `${repeated.length} finding(s) came back after builders worked on them — a paid retry can only repeat itself`,
      evidence: repeated.map(readable),
    };
  }

  const last = earlier[earlier.length - 1]!;
  const cost = round.spendUsd - last.spendUsd;
  if (cost > opts.roundSpendCapUsd && round.findings.length >= last.findings.length) {
    return {
      hold: true,
      reason: `the last round cost $${cost.toFixed(2)} (round cap $${opts.roundSpendCapUsd.toFixed(2)}) and open findings went from ${last.findings.length} to ${round.findings.length}`,
      evidence: round.findings.map(readable),
    };
  }
  return { hold: false };
}

/** The findings that were already open in an earlier round of the same stage (what judgeRound would call a repeat). */
export function repeatedFindings<F extends { file?: string; issue?: string; detail?: string }>(projectId: string, stage: RoundStage, findings: F[]): F[] {
  const seen = new Set(sinceLastRetry(readRounds(projectId), stage).flatMap((h) => h.findings));
  return findings.filter((f) => seen.has(findingKey(f)));
}

/**
 * Called when the owner sends Retry after a hold. Retry re-runs the review before any fix, so without this the same unfixed
 * findings came back and the guard held again, every time. A fix that fails again after the retry still holds.
 */
export function recordRetryReset(projectId: string): void {
  try {
    mkdirSync(buildDirFor(projectId), { recursive: true });
    const marker: RoundRecord = { at: new Date().toISOString(), stage: "qa", findings: [], spendUsd: 0, reset: true };
    appendFileSync(roundsFile(projectId), JSON.stringify(marker) + "\n");
  } catch (err) {
    console.error(`[guard] could not record the retry: ${String(err).slice(0, 160)}`);
  }
}

function roundsFile(projectId: string): string {
  return join(buildDirFor(projectId), "rounds.jsonl");
}

export function readRounds(projectId: string): RoundRecord[] {
  const file = roundsFile(projectId);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as RoundRecord];
      } catch {
        return [];
      }
    });
}

function writeHold(projectId: string, stage: RoundStage, verdict: Extract<GuardVerdict, { hold: true }>, spendUsd: number): void {
  const dir = buildDirFor(projectId);
  mkdirSync(dir, { recursive: true });
  const body = [
    `# Work held — ${stage === "live" ? "live review" : "pre-deploy review"}`,
    "",
    `**Why:** ${verdict.reason}.`,
    `**Spent so far:** $${spendUsd.toFixed(2)}`,
    "",
    "## Evidence",
    ...verdict.evidence.map((e) => `- ${e}`),
    "",
    "## What to do",
    "- Check whether the finding is true (reproduce it on the running app or read the code).",
    "- If it is false: fix or retire the check that raised it. If it is true: find why the builder's fix did not hold.",
    "- Then send Retry. Nothing paid runs until you do.",
    "",
    alternativesSection(readAttempts(dir).map((a) => a.strategyId)),
  ].join("\n");
  writeFileSync(join(dir, "HOLD.md"), body, "utf-8");
  // Tilotma's evidence ledger gets the same facts.
  recordBlocked(projectId, "guard", {
    owner: "tilotma",
    what: `Work held: ${verdict.reason}`,
    checked: verdict.evidence.slice(0, 5).join(" | "),
  });
  console.error(`[GUARD HOLD] ${stage}: ${verdict.reason} — spent $${spendUsd.toFixed(2)}. Report: ${join(dir, "HOLD.md")}`);
}

export interface GuardDeps {
  spend?: (projectId: string) => Promise<number>;
  opts?: GuardOptions;
}

async function realSpend(projectId: string): Promise<number> {
  const { checkBudget } = await import("../../packages/agent-runtime/src/cost-budget.ts");
  return (await checkBudget(projectId)).spentUsd;
}

/**
 * Judges one finished round, records it, and on a hold writes the report.
 * A round whose spend cannot be read is still judged for repeats; the cost
 * rule needs the number, so it is skipped and the round is recorded as such.
 */
export async function checkRoundGuard(
  projectId: string,
  stage: RoundStage,
  findings: Array<{ file?: string; issue?: string; detail?: string }>,
  deps: GuardDeps = {},
): Promise<GuardVerdict> {
  let spendUsd = NaN;
  try {
    spendUsd = await (deps.spend ?? realSpend)(projectId);
  } catch (err) {
    console.error(`[guard] could not read spend (cost rule skipped this round): ${String(err).slice(0, 160)}`);
  }
  const record: RoundRecord = { at: new Date().toISOString(), stage, findings: [...new Set(findings.map(findingKey))], spendUsd: Number.isFinite(spendUsd) ? spendUsd : 0 };
  const opts = deps.opts ?? { roundSpendCapUsd: resolveRoundSpendCapUsd() };
  const history = readRounds(projectId);
  const verdict = judgeRound(history, Number.isFinite(spendUsd) ? record : { ...record, spendUsd: history[history.length - 1]?.spendUsd ?? 0 }, opts);

  mkdirSync(buildDirFor(projectId), { recursive: true });
  appendFileSync(roundsFile(projectId), JSON.stringify(record) + "\n");
  console.log(`[guard] ${stage} round ${history.filter((h) => h.stage === stage && !h.reset).length + 1}: ${record.findings.length} open finding(s), spent $${record.spendUsd.toFixed(2)} — ${verdict.hold ? "HOLD" : "ok"}`);
  if (verdict.hold) writeHold(projectId, stage, verdict, record.spendUsd);
  return verdict;
}
