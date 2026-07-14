import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SubmittedQAFindings {
  agentName: string;
  findings: Array<{ severity?: string; detail?: string; issue?: string }>;
}

export interface LaterFinding {
  severity?: string;
  detail?: string;
  issue?: string;
}

export interface InstinctObservation {
  agentName: string;
  missedFinding: string;
  createdAt: string;
}

export function buildMismatchObservations(
  submissions: SubmittedQAFindings[],
  laterFindings: LaterFinding[],
  createdAt = new Date().toISOString(),
): InstinctObservation[] {
  const critical = laterFindings
    .filter((finding) => finding.severity === "CRITICAL")
    .map((finding) => finding.issue ?? finding.detail ?? "")
    .filter(Boolean);

  return submissions
    .filter((submission) => submission.findings.length === 0)
    .flatMap((submission) => critical.map((missedFinding) => ({ agentName: submission.agentName, missedFinding, createdAt })));
}

export function appendInstinctObservations(
  observations: InstinctObservation[],
  path = join(homedir(), ".local", "share", "nexsidi-instincts", "observations.jsonl"),
): void {
  if (observations.length === 0) return;
  mkdirSync(join(path, ".."), { recursive: true });
  appendFileSync(path, `${observations.map((observation) => JSON.stringify(observation)).join("\n")}\n`, "utf-8");
}

export interface RecurringInstructionUpdate {
  agentName: string;
  missedFinding: string;
  occurrences: number;
}

export function selectRecurringInstructionUpdates(
  observations: InstinctObservation[],
): RecurringInstructionUpdate[] {
  const counts = new Map<string, RecurringInstructionUpdate>();
  for (const observation of observations) {
    const key = `${observation.agentName}\0${observation.missedFinding}`;
    const existing = counts.get(key);
    if (existing) existing.occurrences++;
    else counts.set(key, { agentName: observation.agentName, missedFinding: observation.missedFinding, occurrences: 1 });
  }
  return [...counts.values()].filter((update) => update.occurrences >= 2);
}
