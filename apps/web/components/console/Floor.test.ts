import { test, expect } from "bun:test";
import { deriveFloorSignal, STATIONS } from "./Floor.tsx";
import type { StreamItem, ToolEvent, WorkstreamActivity } from "../../lib/live";

function ws(agent: string, over: Partial<WorkstreamActivity> = {}): WorkstreamActivity {
  return { agent, lastTool: "read_file", lastAt: 0, calls: 1, errors: 0, active: false, ...over };
}
function evItem(e: Partial<ToolEvent> & { agent: string; tool: string; ts: number }, id = 0): StreamItem {
  return { kind: "event", id, event: { type: "tool_call", ...e } as ToolEvent };
}

test("every station id matches a public workstream label, never an internal roster name", () => {
  // CLAUDE.md CONFIDENTIALITY RULE — these strings are rendered on screen, so
  // they must be the same labels the API's sanitiser emits.
  const allowed = new Set([
    "Requirements", "Planning", "Backend", "Frontend", "Database",
    "Logic QA", "Security QA", "Performance QA", "Deployment", "Orchestrator",
  ]);
  for (const st of STATIONS) expect(allowed.has(st.id)).toBe(true);
});

test("deriveFloorSignal lights only workstreams that are genuinely active", () => {
  const signal = deriveFloorSignal(
    [ws("Backend", { active: true }), ws("Database", { active: false })],
    [],
    1000,
  );

  expect(signal.active.has("Backend")).toBe(true);
  expect(signal.active.has("Database")).toBe(false);
});

test("deriveFloorSignal counts findings and escalations as adversarial attacks", () => {
  const items = [
    evItem({ agent: "Security QA", tool: "submit_findings", ts: 900 }, 0),
    evItem({ agent: "Logic QA", tool: "escalate_finding", ts: 950 }, 1),
    evItem({ agent: "Backend", tool: "write_file", ts: 960 }, 2),
  ];

  const signal = deriveFloorSignal([], items, 1000);

  expect(signal.attackCount).toBe(2);
  expect(signal.attacking).toBe(true);
});

test("deriveFloorSignal stops showing an attack once it falls outside the window", () => {
  const items = [evItem({ agent: "Security QA", tool: "submit_findings", ts: 1_000 }, 0)];

  const signal = deriveFloorSignal([], items, 100_000, 30_000);

  expect(signal.attackCount).toBe(1);   // still counted historically
  expect(signal.attacking).toBe(false); // but no longer animating
});

test("deriveFloorSignal does not treat a tool_result as a new attack, only the call", () => {
  const items = [
    evItem({ agent: "Logic QA", tool: "submit_findings", ts: 900 }, 0),
    { kind: "event", id: 1, event: { agent: "Logic QA", tool: "submit_findings", ts: 901, type: "tool_result", status: "success" } as ToolEvent } as StreamItem,
  ];

  expect(deriveFloorSignal([], items, 1000).attackCount).toBe(1);
});

test("deriveFloorSignal reports an idle pipeline as not attacking, so nothing animates on a dead feed", () => {
  const signal = deriveFloorSignal([ws("Backend")], [], 1000);

  expect(signal.attacking).toBe(false);
  expect(signal.attackCount).toBe(0);
  expect(signal.active.size).toBe(0);
});
