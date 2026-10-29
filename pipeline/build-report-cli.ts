// bun pipeline/build-report-cli.ts <projectId> [output.md]
// Cost and time of a build, agent by agent and round by round, from recorded facts (see build-report.ts):
//   the per-call ledger (.call-ledger.jsonl in the builds folder), the workflow's own step times (Temporal history),
//   the review rounds (rounds.jsonl) and the project's spend total.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { readCallLedger } from "../packages/llm-client/src/call-ledger.ts";
import { computeCostUsd, checkBudget } from "../packages/agent-runtime/src/cost-budget.ts";
import { buildDirFor } from "../packages/agent-runtime/src/build-dir.ts";
import { aggregate, buildWindows, renderReport, type Activity, type RoundMark } from "./build-report.ts";
import { workflowFacts, roundFacts, renderSuccessSheet, type HistoryEventLite } from "./success-sheet.ts";
import { systemVersionFacts } from "./orchestrator/system-version.ts";

const projectId = process.argv[2];
if (!projectId) {
  console.error("usage: bun pipeline/build-report-cli.ts <projectId> [output.md]");
  process.exit(1);
}

// The workflow's own history, read with the Temporal CLI inside its container (readable event names and ISO times).
interface HistoryEvent {
  eventId: string | number;
  eventType: string;
  eventTime: string;
  activityTaskScheduledEventAttributes?: { activityType?: { name?: string } };
  activityTaskCompletedEventAttributes?: { scheduledEventId?: string | number };
  activityTaskFailedEventAttributes?: { scheduledEventId?: string | number };
  activityTaskTimedOutEventAttributes?: { scheduledEventId?: string | number };
}
const container = execSync('docker ps --filter "name=temporal-1" --format "{{.Names}}"', { encoding: "utf-8" }).split(/\r?\n/).map((x) => x.trim()).find((n) => n && !n.includes("ui"));
if (!container) {
  console.error("the Temporal container is not running");
  process.exit(1);
}
const raw = execFileSync("docker", ["exec", container, "sh", "-c", `temporal workflow show -w project-build-${projectId} --address $(hostname -i):7233 -o json`], { encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 });
const parsed = JSON.parse(raw) as { events?: HistoryEvent[] } | HistoryEvent[];
const events: HistoryEvent[] = Array.isArray(parsed) ? parsed : parsed.events ?? [];
const tsMs = (iso: string) => Date.parse(iso);
const activities: Activity[] = [];
const scheduled = new Map<string, { name: string; start: number }>();
let workflowStart = 0;
let workflowEnd = Date.now();
for (const e of events) {
  const id = String(e.eventId);
  const type = String(e.eventType);
  const when = tsMs(e.eventTime);
  if (/WORKFLOW_EXECUTION_STARTED$/.test(type)) workflowStart = when;
  if (/WORKFLOW_EXECUTION_(COMPLETED|FAILED|TERMINATED|TIMED_OUT|CANCELED)$/.test(type)) workflowEnd = when;
  if (/ACTIVITY_TASK_SCHEDULED$/.test(type)) scheduled.set(id, { name: String(e.activityTaskScheduledEventAttributes?.activityType?.name ?? "activity"), start: when });
  if (/ACTIVITY_TASK_(COMPLETED|FAILED|TIMED_OUT)$/.test(type)) {
    const a = e.activityTaskCompletedEventAttributes ?? e.activityTaskFailedEventAttributes ?? e.activityTaskTimedOutEventAttributes;
    const s = scheduled.get(String(a?.scheduledEventId));
    if (s && when - s.start >= 2000) activities.push({ name: s.name, start: s.start, end: when });
  }
}

if (activities.length === 0) {
  console.error("no workflow steps found for this project");
  process.exit(1);
}

const dir = buildDirFor(projectId);
const rounds: RoundMark[] = [];
const roundsFile = join(dir, "rounds.jsonl");
if (existsSync(roundsFile)) {
  for (const line of readFileSync(roundsFile, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as { at: string; stage: string; findings: unknown[] };
      rounds.push({ at: Date.parse(r.at), stage: r.stage, findings: r.findings?.length ?? 0 });
    } catch {
      // a torn line is skipped
    }
  }
}

const planningFrom = workflowStart - 40 * 60_000;
const rows = readCallLedger().filter((r) => {
  const end = Date.parse(r.at);
  if (r.projectId) return r.projectId === projectId;
  return end >= planningFrom && end <= workflowEnd + 60_000; // not tied to a project: assigned by time
});
const windows = buildWindows(activities, rounds, workflowEnd, { planningFrom });
const report = aggregate(rows, windows, (model, tin, tout, cached) => {
  try {
    return computeCostUsd(tin, tout, model, cached);
  } catch {
    return NaN;
  }
});
let spend: number | undefined;
try {
  spend = (await checkBudget(projectId)).spentUsd;
} catch {
  spend = undefined;
}
// The success sheet: delivered or not, holds, restarts, system version, rounds — each from its own record.
let delivered: boolean | null = null;
try {
  const { db, projects } = await import("@nexsidi/db");
  const { eq } = await import("drizzle-orm");
  const [p] = await db.select({ status: projects.status }).from(projects).where(eq(projects.id, projectId)).limit(1);
  delivered = p ? p.status === "done" : null;
} catch {
  delivered = null;
}
const roundLines: Array<{ stage: string; findings?: unknown[]; reset?: boolean }> = [];
if (existsSync(roundsFile)) {
  for (const line of readFileSync(roundsFile, "utf-8").split("\n")) {
    try {
      if (line.trim()) roundLines.push(JSON.parse(line));
    } catch {
      // a torn line is skipped
    }
  }
}
const wfFacts = workflowFacts(events as HistoryEventLite[]);
// A held workflow has no end event: its time runs to its last recorded event, not to now.
const lastRecorded = wfFacts.ended ? workflowEnd : Date.parse(wfFacts.lastEventAt ?? new Date(workflowEnd).toISOString());
const workflowMinutes = Math.round((lastRecorded - workflowStart) / 60_000);
const sheet = renderSuccessSheet({
  delivered,
  workflow: wfFacts,
  rounds: roundFacts(roundLines),
  version: systemVersionFacts(dir),
  costUsd: report.total.costUsd,
  minutes: workflowMinutes,
});
const md = renderReport(`Build ${projectId}`, report, { agentSpendUsd: spend, workflowMinutes, sheet });
const out = process.argv[3];
if (out) {
  writeFileSync(out, md, "utf-8");
  console.log(`written: ${out} (${md.length} chars, ${report.total.callsOk + report.total.callsFailed} calls)`);
} else {
  console.log(md);
}
process.exit(0);
