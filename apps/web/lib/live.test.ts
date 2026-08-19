import { test, expect } from "bun:test";
import { deriveWorkstreams, deriveTouchedFiles, deriveActiveWrites, type StreamItem, type ToolEvent } from "./live.ts";

function ev(partial: Partial<ToolEvent> & { agent: string; tool: string; ts: number }): ToolEvent {
  return { type: "tool_call", ...partial } as ToolEvent;
}

function stream(...events: ToolEvent[]): StreamItem[] {
  return events.map((e, i) => ({ kind: "event", id: i, event: e }));
}

// ── deriveWorkstreams ───────────────────────────────────────────────────────

test("deriveWorkstreams rolls events up into one row per workstream, newest first", () => {
  const now = 10_000;
  const items = stream(
    ev({ agent: "Backend", tool: "write_file", ts: 1_000 }),
    ev({ agent: "Frontend", tool: "read_file", ts: 5_000 }),
    ev({ agent: "Backend", tool: "run_command", ts: 3_000 }),
  );

  const rows = deriveWorkstreams(items, now);

  expect(rows.map((r) => r.agent)).toEqual(["Frontend", "Backend"]);
  expect(rows.find((r) => r.agent === "Backend")!.calls).toBe(2);
});

test("deriveWorkstreams reports the most recent tool, not whichever event arrived last", () => {
  const now = 10_000;
  // Deliberately out of chronological order — the WS replays history on
  // connect, and a later frame can carry an older timestamp.
  const items = stream(
    ev({ agent: "Backend", tool: "run_command", ts: 8_000 }),
    ev({ agent: "Backend", tool: "read_file", ts: 2_000 }),
  );

  expect(deriveWorkstreams(items, now)[0]!.lastTool).toBe("run_command");
});

test("deriveWorkstreams marks a workstream active only inside the recency window", () => {
  const now = 100_000;
  const items = stream(
    ev({ agent: "Backend", tool: "write_file", ts: 99_000 }),  // 1s ago
    ev({ agent: "Database", tool: "db_query", ts: 40_000 }),   // 60s ago
  );

  const rows = deriveWorkstreams(items, now, 20_000);

  expect(rows.find((r) => r.agent === "Backend")!.active).toBe(true);
  expect(rows.find((r) => r.agent === "Database")!.active).toBe(false);
});

test("deriveWorkstreams counts errors separately from calls", () => {
  const items = stream(
    ev({ agent: "Deployment", tool: "run_command", ts: 1_000 }),
    ev({ agent: "Deployment", tool: "run_command", ts: 1_100, type: "tool_result", status: "error" }),
    ev({ agent: "Deployment", tool: "run_command", ts: 1_200, type: "tool_result", status: "success" }),
  );

  const row = deriveWorkstreams(items, 2_000)[0]!;

  expect(row.calls).toBe(1);   // only tool_call counts as a call
  expect(row.errors).toBe(1);
});

test("deriveWorkstreams ignores raw log lines, which carry no workstream identity", () => {
  const items: StreamItem[] = [
    { kind: "log", id: 0, text: "some raw output" },
    ...stream(ev({ agent: "Planning", tool: "list_files", ts: 500 })),
  ];

  expect(deriveWorkstreams(items, 1_000)).toHaveLength(1);
});

// ── deriveTouchedFiles ──────────────────────────────────────────────────────

test("deriveTouchedFiles collects write/edit/delete paths, newest first", () => {
  const items = stream(
    ev({ agent: "Backend", tool: "write_file", ts: 1_000, input: { path: "src/a.ts" } }),
    ev({ agent: "Backend", tool: "edit_file", ts: 3_000, input: { path: "src/b.ts" } }),
  );

  expect(deriveTouchedFiles(items).map((f) => f.path)).toEqual(["backend/src/b.ts", "backend/src/a.ts"]);
});

test("deriveTouchedFiles expands a write_files batch into its individual paths", () => {
  const items = stream(
    ev({ agent: "Frontend", tool: "write_files", ts: 1_000, input: { count: 2, paths: ["a.tsx", "b.tsx"] } }),
  );

  expect(deriveTouchedFiles(items).map((f) => f.path).sort()).toEqual(["frontend/a.tsx", "frontend/b.tsx"]);
});

test("deriveTouchedFiles keeps only the latest touch per path, so a file rewritten twice appears once", () => {
  const items = stream(
    ev({ agent: "Backend", tool: "write_file", ts: 1_000, input: { path: "src/a.ts" } }),
    ev({ agent: "Backend", tool: "write_file", ts: 9_000, input: { path: "src/a.ts" } }),
  );

  const files = deriveTouchedFiles(items);

  expect(files).toHaveLength(1);
  expect(files[0]!.at).toBe(9_000);
});

test("deriveTouchedFiles excludes reads — a file that was only looked at was not touched", () => {
  const items = stream(
    ev({ agent: "Logic QA", tool: "read_file", ts: 1_000, input: { path: "src/reviewed.ts" } }),
    ev({ agent: "Backend", tool: "write_file", ts: 2_000, input: { path: "src/written.ts" } }),
  );

  expect(deriveTouchedFiles(items).map((f) => f.path)).toEqual(["backend/src/written.ts"]);
});

// Real bug found live (Brightline Consulting test build): every generator
// agent runs with its own subdirectory as its tool sandbox root (see
// agents/generators/{aanya,shubham,pranav}/src/index.ts), so a write
// event's own path is relative to THAT subdirectory — but the Explorer
// tree's paths are relative to the project root. Before this fix, a write
// event for "docker-compose.yml" from Frontend never matched the tree's
// "frontend/docker-compose.yml", so no file ever visibly streamed in
// during an entire real build.
test("deriveTouchedFiles prefixes a Frontend write with frontend/, matching the Explorer tree's own paths", () => {
  const items = stream(ev({ agent: "Frontend", tool: "write_file", ts: 1_000, input: { path: "docker-compose.yml" } }));
  expect(deriveTouchedFiles(items).map((f) => f.path)).toEqual(["frontend/docker-compose.yml"]);
});

test("deriveTouchedFiles prefixes a Backend write with backend/", () => {
  const items = stream(ev({ agent: "Backend", tool: "write_file", ts: 1_000, input: { path: "src/app.ts" } }));
  expect(deriveTouchedFiles(items).map((f) => f.path)).toEqual(["backend/src/app.ts"]);
});

test("deriveTouchedFiles prefixes a Database write with db/", () => {
  const items = stream(ev({ agent: "Database", tool: "write_file", ts: 1_000, input: { path: "schema.ts" } }));
  expect(deriveTouchedFiles(items).map((f) => f.path)).toEqual(["db/schema.ts"]);
});

test("deriveTouchedFiles leaves a path unprefixed for an agent with no known subdirectory root (e.g. deploy writing project-root docker-compose.yml)", () => {
  const items = stream(ev({ agent: "Deployment", tool: "write_file", ts: 1_000, input: { path: "docker-compose.yml" } }));
  expect(deriveTouchedFiles(items).map((f) => f.path)).toEqual(["docker-compose.yml"]);
});

// ── deriveActiveWrites ───────────────────────────────────────────────────────

test("deriveActiveWrites marks a file written inside the recency window as actively writing", () => {
  const now = 10_000;
  const items = stream(ev({ agent: "Backend", tool: "write_file", ts: 9_000, input: { path: "src/a.ts" } }));

  expect(deriveActiveWrites(items, now).has("backend/src/a.ts")).toBe(true);
});

test("deriveActiveWrites drops a file once its write falls outside the window — it becomes 'freshly written', not 'writing now'", () => {
  const now = 20_000;
  const items = stream(ev({ agent: "Backend", tool: "write_file", ts: 9_000, input: { path: "src/a.ts" } }));

  expect(deriveActiveWrites(items, now, 6_000).has("backend/src/a.ts")).toBe(false);
});

test("deriveActiveWrites includes every path from a write_files batch", () => {
  const now = 10_000;
  const items = stream(
    ev({ agent: "Frontend", tool: "write_files", ts: 9_500, input: { paths: ["a.tsx", "b.tsx"] } }),
  );

  const active = deriveActiveWrites(items, now);
  expect(active.has("frontend/a.tsx")).toBe(true);
  expect(active.has("frontend/b.tsx")).toBe(true);
});

test("deriveActiveWrites excludes reads — only write-shaped tools count as 'being written'", () => {
  const now = 10_000;
  const items = stream(ev({ agent: "Backend", tool: "read_file", ts: 9_900, input: { path: "src/a.ts" } }));

  expect(deriveActiveWrites(items, now).size).toBe(0);
});
