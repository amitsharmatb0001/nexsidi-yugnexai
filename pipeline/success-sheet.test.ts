import { test, expect } from "bun:test";
import { workflowFacts, roundFacts, renderSuccessSheet, type SheetInput } from "./success-sheet.ts";

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
const escalation = (at: string, reason: string) => ({
  eventType: "EVENT_TYPE_ACTIVITY_TASK_SCHEDULED",
  eventTime: at,
  activityTaskScheduledEventAttributes: { activityType: { name: "escalateTilotma" }, input: { payloads: [{ data: b64("p1") }, { data: b64(reason) }, { data: b64({}) }] } },
});
const signal = (at: string, name: string, value: unknown) => ({
  eventType: "EVENT_TYPE_WORKFLOW_EXECUTION_SIGNALED",
  eventTime: at,
  workflowExecutionSignaledEventAttributes: { signalName: name, input: { payloads: [{ data: b64(value) }] } },
});

test("holds are read from the escalation steps, with their reasons", () => {
  const f = workflowFacts([escalation("2026-10-25T11:30:44Z", "generation_failed"), escalation("2026-10-25T13:59:47Z", "budget_exceeded")]);
  expect(f.holds).toEqual([
    { at: "2026-10-25T11:30:44Z", reason: "generation_failed" },
    { at: "2026-10-25T13:59:47Z", reason: "budget_exceeded" },
  ]);
});

test("restarts are the owner's Retry signals; approvals and abandons are not restarts", () => {
  const f = workflowFacts([
    signal("t1", "retryStageSignal", true),
    signal("t2", "retryStageSignal", false),
    signal("t3", "approveSpecSignal", true),
    signal("t4", "retryStageSignal", true),
  ]);
  expect(f.restarts).toBe(2);
});

test("a held workflow's time runs from its start to its last recorded event, not to now", () => {
  const f = workflowFacts([
    { eventType: "EVENT_TYPE_WORKFLOW_EXECUTION_STARTED", eventTime: "2026-10-25T10:45:00Z" },
    escalation("2026-10-26T10:20:53Z", "budget_exceeded"),
    { eventType: "EVENT_TYPE_TIMER_STARTED", eventTime: "2026-10-26T10:20:54Z" },
    { eventType: "EVENT_TYPE_TIMER_FIRED", eventTime: "2026-10-29T07:08:10Z" },
    { eventType: "EVENT_TYPE_WORKFLOW_TASK_SCHEDULED", eventTime: "2026-10-29T07:08:10Z" },
  ]);
  expect(f.startedAt).toBe("2026-10-25T10:45:00Z");
  expect(f.lastEventAt).toBe("2026-10-26T10:20:53Z");
});

test("a workflow without an end event is still running or held", () => {
  expect(workflowFacts([escalation("t", "stuck_state")]).ended).toBeNull();
  expect(workflowFacts([{ eventType: "EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED", eventTime: "t9" }]).ended).toBe("COMPLETED");
});

test("rounds are counted per stage, restart markers are not rounds, and the last round's findings are kept", () => {
  const r = roundFacts([
    { stage: "qa", findings: [], reset: true },
    { stage: "qa", findings: ["a", "b"] },
    { stage: "qa", findings: ["a"] },
    { stage: "live", findings: [], reset: true },
    { stage: "live", findings: ["x", "y", "z"] },
  ]);
  expect(r).toEqual({ reviewRounds: 2, liveRounds: 1, lastRoundFindings: 3 });
});

const base: SheetInput = {
  delivered: true,
  workflow: { holds: [], restarts: 0, ended: "COMPLETED" },
  rounds: { reviewRounds: 1, liveRounds: 1, lastRoundFindings: 0 },
  version: { recorded: true, startedOn: "abc", changes: 0, accepted: 0, notChecked: 0 },
  costUsd: 12.5,
  minutes: 58,
};

test("a delivered build with no restart, no hold and one recorded version is untouched", () => {
  const md = renderSuccessSheet(base);
  expect(md).toContain("## Success sheet");
  expect(md).toContain("**Untouched run: yes**");
  expect(md).toContain("$12.50");
  expect(md).toContain("58 min");
});

test("acceptance tests are reported as not checked until the tester exists", () => {
  expect(renderSuccessSheet(base)).toContain("not checked");
});

test("each reason a run is not untouched is named", () => {
  const md = renderSuccessSheet({
    ...base,
    delivered: false,
    workflow: { holds: [{ at: "2026-10-25T13:59:47Z", reason: "budget_exceeded" }], restarts: 6, ended: null },
    version: { recorded: true, startedOn: "abc", changes: 2, accepted: 1, notChecked: 1 },
  });
  expect(md).toContain("**Untouched run: no**");
  expect(md).toContain("not delivered");
  expect(md).toContain("6 restarts by a person");
  expect(md).toContain("the system changed 2 times during the build");
  expect(md).toContain("the system version could not be checked 1 time");
  expect(md).toContain("13:59:47 budget_exceeded");
});

test("a build that predates the version stamp cannot count as untouched", () => {
  const md = renderSuccessSheet({ ...base, version: { recorded: false, startedOn: null, changes: 0, accepted: 0, notChecked: 0 } });
  expect(md).toContain("**Untouched run: no**");
  expect(md).toContain("the system version was not recorded");
});

test("an unknown delivery state is said, not guessed", () => {
  expect(renderSuccessSheet({ ...base, delivered: null })).toContain("delivery state not checked");
});
