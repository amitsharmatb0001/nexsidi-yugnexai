// The success sheet at the top of a build report: was this one untouched run of one system version, and if not, why.
// Every line comes from a record (the workflow's history, rounds.jsonl, the system-version file, the call ledger);
// what was not recorded is said, never assumed.
import type { SystemVersionFacts } from "./orchestrator/system-version.ts";
import type { AcceptanceFacts } from "./orchestrator/acceptance-runner.ts";

interface Payloads {
  payloads?: Array<{ data?: string }>;
}
export interface HistoryEventLite {
  eventType: string;
  eventTime: string;
  activityTaskScheduledEventAttributes?: { activityType?: { name?: string }; input?: Payloads };
  workflowExecutionSignaledEventAttributes?: { signalName?: string; input?: Payloads };
}

export interface WorkflowFacts {
  holds: Array<{ at: string; reason: string }>;
  restarts: number;
  ended: string | null;
  startedAt?: string;
  lastEventAt?: string;
}

function decode(p: Payloads | undefined, i: number): unknown {
  const data = p?.payloads?.[i]?.data;
  if (!data) return undefined;
  try {
    return JSON.parse(Buffer.from(data, "base64").toString("utf-8"));
  } catch {
    return undefined;
  }
}

export function workflowFacts(events: HistoryEventLite[]): WorkflowFacts {
  const holds: WorkflowFacts["holds"] = [];
  let restarts = 0;
  let ended: string | null = null;
  let startedAt: string | undefined;
  let lastEventAt: string | undefined;
  for (const e of events) {
    if (/WORKFLOW_EXECUTION_STARTED$/.test(e.eventType)) startedAt = e.eventTime;
    // Work and decisions only: timers and workflow-task bookkeeping fire while a held build waits.
    if (/ACTIVITY_TASK_|WORKFLOW_EXECUTION_/.test(e.eventType)) lastEventAt = e.eventTime;
    const sched = e.activityTaskScheduledEventAttributes;
    if (/ACTIVITY_TASK_SCHEDULED$/.test(e.eventType) && sched?.activityType?.name === "escalateTilotma") {
      holds.push({ at: e.eventTime, reason: String(decode(sched.input, 1) ?? "unknown") });
    }
    const sig = e.workflowExecutionSignaledEventAttributes;
    if (/WORKFLOW_EXECUTION_SIGNALED$/.test(e.eventType) && sig?.signalName === "retryStageSignal" && decode(sig.input, 0) === true) restarts++;
    const end = e.eventType.match(/WORKFLOW_EXECUTION_(COMPLETED|FAILED|TERMINATED|TIMED_OUT|CANCELED)$/);
    if (end) ended = end[1]!;
  }
  return { holds, restarts, ended, startedAt, lastEventAt };
}

export interface RoundFacts {
  reviewRounds: number;
  liveRounds: number;
  lastRoundFindings: number | null;
}

export function roundFacts(rounds: Array<{ stage: string; findings?: unknown[]; reset?: boolean }>): RoundFacts {
  const real = rounds.filter((r) => !r.reset);
  return {
    reviewRounds: real.filter((r) => r.stage === "qa").length,
    liveRounds: real.filter((r) => r.stage === "live").length,
    lastRoundFindings: real.length ? (real[real.length - 1]!.findings?.length ?? 0) : null,
  };
}

export interface SheetInput {
  delivered: boolean | null;
  workflow: WorkflowFacts;
  rounds: RoundFacts;
  version: SystemVersionFacts;
  costUsd: number;
  minutes: number;
  /** the tests the tester wrote (null: none) and the runner's runs on the app (null: never run) */
  acceptance?: { written: number | null; runs: AcceptanceFacts | null };
}

function acceptanceLine(a: SheetInput["acceptance"]): string {
  if (!a || a.written === null) return "not written (this build has no acceptance tests)";
  if (!a.runs) return `${a.written} written; never run on the app`;
  const l = a.runs.last;
  return `${l.passed} of ${l.total} passed on the last of ${a.runs.runs} run${a.runs.runs === 1 ? "" : "s"} (${l.failed} failed, ${l.notChecked} not checked)`;
}

const times = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function renderSuccessSheet(s: SheetInput): string {
  const why: string[] = [];
  if (s.delivered === false) why.push("not delivered");
  if (s.delivered === null) why.push("delivery state not checked");
  if (s.workflow.restarts > 0) why.push(`${times(s.workflow.restarts, "restart")} by a person`);
  if (!s.version.recorded) why.push("the system version was not recorded (the build predates the version stamp)");
  if (s.version.changes > 0) why.push(`the system changed ${times(s.version.changes, "time")} during the build`);
  if (s.version.notChecked > 0) why.push(`the system version could not be checked ${times(s.version.notChecked, "time")}`);
  const untouched = why.length === 0;
  const holds = s.workflow.holds.length
    ? s.workflow.holds.map((h) => `${h.at.slice(11, 19)} ${h.reason}`).join("; ")
    : "none";
  const lines = [
    "## Success sheet",
    "",
    `**Untouched run: ${untouched ? "yes" : "no"}**${untouched ? "" : ` — ${why.join("; ")}.`}`,
    "",
    "| measure | result |",
    "|---|---|",
    `| delivered | ${s.delivered === null ? "not checked" : s.delivered ? "yes" : "no"}${s.workflow.ended ? ` (workflow ${s.workflow.ended.toLowerCase()})` : " (workflow still running or held)"} |`,
    `| holds | ${s.workflow.holds.length} — ${holds} |`,
    `| restarts by a person (Retry) | ${s.workflow.restarts} |`,
    `| system version | ${s.version.recorded ? `started on ${s.version.startedOn ?? "unknown"}; changed ${s.version.changes}, accepted by Retry ${s.version.accepted}, not checked ${s.version.notChecked}` : "not recorded"} |`,
    `| review rounds (code / live) | ${s.rounds.reviewRounds} / ${s.rounds.liveRounds} |`,
    `| findings in the last round | ${s.rounds.lastRoundFindings ?? "no round recorded"} |`,
    `| acceptance tests | ${acceptanceLine(s.acceptance)} |`,
    `| cost (call ledger) | $${s.costUsd.toFixed(2)} |`,
    `| time | ${s.minutes} min |`,
    "",
  ];
  return lines.join("\n");
}
