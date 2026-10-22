// Per-build evidence that each patent-claim step actually ran (2026-10-22). Several of those steps print nothing when they
// work, so after the Trailhead build it could not be shown whether they ran at all. Every step now appends one line to
// <build>/.nexsidi/claims-evidence.jsonl; `bun scripts/claims-report.ts <project>` reads them back as a table.
// The file sits under .nexsidi, which the handoff manifests exclude, so writing it never changes a handoff hash.
// Recording never throws: evidence must not be able to break a build.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ClaimNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface ClaimEvidence {
  at: string;
  claim: number;
  step: string;
  detail: Record<string, unknown>;
}

/** Short names of the ten filed claims (docs/patent-alignment.md). */
export const CLAIM_TITLES: Record<ClaimNumber, string> = {
  1: "Multi-agent system: task graph, verified handoffs, three adversarial reviewers",
  2: "Method: the same flow ending in deployment with zero critical errors",
  3: "Context protocol: hashing, traceability, atomic handoff, rollback",
  4: "Adversarial training: missed defects fed back to the reviewers",
  5: "Isolated containers for running generated code",
  6: "Convergence: iterate until clean, limits, stuck detection",
  7: "Mistake memory: recurring patterns fed into prompts",
  8: "Security agent: pattern database and taint analysis (attack inputs not built)",
  9: "Performance agent: growth estimates, leaks, regressions",
  10: "Hash chain: each handoff holds the hashes of all earlier ones",
};

const fileFor = (buildDir: string) => join(buildDir, ".nexsidi", "claims-evidence.jsonl");

export function recordClaimEvidence(buildDir: string, claim: ClaimNumber, step: string, detail: Record<string, unknown> = {}): void {
  try {
    // Never creates the build folder itself: a folder made early under the wrong name would confuse the build.
    if (!existsSync(buildDir)) return;
    mkdirSync(join(buildDir, ".nexsidi"), { recursive: true });
    const row: ClaimEvidence = { at: new Date().toISOString(), claim, step, detail };
    appendFileSync(fileFor(buildDir), JSON.stringify(row) + "\n", "utf-8");
  } catch {
    /* never fatal */
  }
}

export function readClaimEvidence(buildDir: string): ClaimEvidence[] {
  try {
    if (!existsSync(fileFor(buildDir))) return [];
    return readFileSync(fileFor(buildDir), "utf-8")
      .split("\n")
      .filter(Boolean)
      .flatMap((l) => {
        try { return [JSON.parse(l) as ClaimEvidence]; } catch { return []; }
      });
  } catch {
    return [];
  }
}

export interface ClaimSummary {
  claim: ClaimNumber;
  title: string;
  ran: boolean;
  count: number;
  entries: ClaimEvidence[];
}

export function summarizeClaims(rows: ClaimEvidence[]): ClaimSummary[] {
  return (Object.keys(CLAIM_TITLES).map(Number) as ClaimNumber[]).map((claim) => {
    const entries = rows.filter((r) => r.claim === claim);
    return { claim, title: CLAIM_TITLES[claim], ran: entries.length > 0, count: entries.length, entries };
  });
}
