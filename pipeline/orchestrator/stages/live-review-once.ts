// The live review runs once (2026-10-30, team plan stage 5). The live step re-ran the three reviewers, the browser review
// and the design review after every fix round, and each round brought new findings. Now the static reviewers run once in
// the review step (stage5-review-once.ts); here the browser review and the design review each run once, and their
// findings need proof like every review finding (../review-proof.ts): a browser finding carries its reproduction at the
// end of its line ("REPRO: {…}"), and the runner must see it fail. After that, the live rounds run the system's own checks
// and the acceptance tests only; a failing test is a finding for its owner (an API test for the backend builder, a journey
// for the frontend builder), proven by the runner.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "./stage4-multi-agent-dev.ts";
import type { AcceptanceTest } from "../acceptance-tests.ts";
import type { RunSummary } from "../acceptance-runner.ts";
import { adoptReviewTests, proveReviewFindings, recordReviewNotes, type ReviewFinding } from "../review-proof.ts";
import { planScope } from "../acceptance-tests.ts";
import { buildDirFor } from "../../../packages/agent-runtime/src/build-dir.ts";

const REPRO = /\s*REPRO:\s*(\{[\s\S]*\})\s*$/;

/** A browser finding's line, split into the finding and its reproduction. A reproduction that is not JSON is not one. */
export function splitRepro(line: string): { issue: string; reproduction?: Record<string, unknown> } {
  const m = line.match(REPRO);
  if (!m) return { issue: line };
  try {
    const v = JSON.parse(m[1]!) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return { issue: line.slice(0, m.index).trimEnd(), reproduction: v as Record<string, unknown> };
  } catch {
    /* not JSON: the line stays as it is */
  }
  return { issue: line };
}

const stateFile = (projectDir: string) => join(projectDir, ".nexsidi", "live-review-once.json");

/** Which of the two model reviews of the live app already ran for this build. */
export function liveReviewState(projectDir: string): { browser?: string; design?: string } {
  try {
    return existsSync(stateFile(projectDir)) ? (JSON.parse(readFileSync(stateFile(projectDir), "utf-8")) as { browser?: string; design?: string }) : {};
  } catch {
    return {};
  }
}

export function markLiveReview(projectDir: string, which: "browser" | "design"): void {
  mkdirSync(join(projectDir, ".nexsidi"), { recursive: true });
  writeFileSync(stateFile(projectDir), JSON.stringify({ ...liveReviewState(projectDir), [which]: new Date().toISOString() }));
}

/** The folder a failing test's fix belongs to: the backend for an API test, the frontend for a journey. */
const fileFor = (t: AcceptanceTest | undefined) => (t?.kind === "journey" ? "frontend/app" : "backend/src");

/** Failing acceptance tests as findings for their owners. Proven by the runner, so no further check is needed. */
export function acceptanceFailureFindings(run: RunSummary, tests: AcceptanceTest[]): Finding[] {
  const byId = new Map(tests.map((t) => [t.id, t]));
  return run.results
    .filter((r) => r.status === "failed")
    .map((r) => ({ file: fileFor(byId.get(r.id)), issue: `[acceptance] ${r.id} [${r.planItem}] ${r.title} — fails on the running app${r.step ? ` at step ${r.step}` : ""}: ${r.detail}` }));
}

/**
 * The browser review's findings through the proof rule: a reproduced finding becomes a permanent test and a finding for its
 * owner; the rest go to the notes. Browser findings name no file, so they cannot stand on quoted code.
 */
export async function proveLiveFindings(
  projectId: string,
  lines: string[],
  reproduce: (tests: AcceptanceTest[]) => Promise<RunSummary>,
): Promise<{ findings: Finding[]; notes: number }> {
  const dir = buildDirFor(projectId);
  const findings: ReviewFinding[] = lines.map((l) => ({ file: "", ...splitRepro(l) }));
  const proven = await proveReviewFindings(findings, planScope(dir), { reproduce });
  recordReviewNotes(dir, [...proven.notes, ...proven.code.map((c) => ({ finding: c.finding, reason: "a browser finding names no file, so it needs a reproduction" }))]);
  const added = adoptReviewTests(dir, proven.confirmedTests.map((c) => c.test));
  const out: Finding[] = proven.confirmedTests.map((c, i) => ({
    file: fileFor(added[i]),
    issue: `[acceptance] ${added[i]!.id} [${added[i]!.planItem}] ${added[i]!.title} — fails on the running app: ${c.detail}`,
  }));
  return { findings: out, notes: proven.notes.length + proven.code.length };
}

/** What the browser reviewer is told about proof (team plan stage 5). */
export function reproInstruction(): string {
  return `

PROOF: you review the live app once; there is no second review. A finding about what the customer asked for (an SC, EP, ANS
or ROLES item) must end its line with REPRO: and a test, on one line, that FAILS on the app while the finding is true —
{"title": "...", "as": "anyone"|"user"|a role, "kind": "journey"|"api", "steps": [...]}. Journey steps: {"do": "open", "path"},
{"do": "fill", "field", "value"}, {"do": "click", "text"}, {"do": "see", "text"}, {"do": "atPath", "path"}; API steps:
{"method", "path", "body", "expectStatus": [200], "expectBody": [{"path", "equals"}]}. Use the labels and words a person sees.
The system runs the test before any builder sees the finding; a finding without it, or whose test passes, goes to the notes.`;
}
