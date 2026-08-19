import { test, expect } from "bun:test";
import { narrate, describeAction } from "./narrate.ts";
import type { StreamItem, ToolEvent } from "../../lib/live";

function ev(e: Partial<ToolEvent> & { agent: string; tool: string; ts: number }, id = 0): StreamItem {
  return { kind: "event", id, event: { type: "tool_call", ...e } as ToolEvent };
}

test("narrate drops raw log lines entirely — the point is prose, not a terminal", () => {
  const items: StreamItem[] = [
    { kind: "log", id: 0, text: "2026-08-18T18:12:47.040Z [riya] usage: 6464 in / 600 out" },
    ev({ agent: "Backend", tool: "write_file", ts: 1, input: { path: "src/app.ts" } }, 1),
  ];

  const out = narrate(items);
  expect(out).toHaveLength(1);
  expect(out[0]!.text).toBe("Writing a file");
});

test("narrate surfaces the agent's own reasoning as the prose", () => {
  const items = [ev({ agent: "Deployment", tool: "", ts: 5, type: "thinking", text: "Let's inspect docker-compose.yml to see what was written." }, 0)];
  const out = narrate(items);

  expect(out[0]!.kind).toBe("thinking");
  expect(out[0]!.text).toBe("Let's inspect docker-compose.yml to see what was written.");
});

test("narrate stays silent about reads — they are how an agent thinks, not work worth reporting", () => {
  const items = [
    ev({ agent: "Logic QA", tool: "read_file", ts: 1, input: { path: "a.ts" } }, 0),
    ev({ agent: "Logic QA", tool: "list_files", ts: 2 }, 1),
  ];
  expect(narrate(items)).toHaveLength(0);
});

test("narrate folds repeated identical actions into one counted line", () => {
  const items = [
    ev({ agent: "Frontend", tool: "write_file", ts: 1, input: { path: "a.tsx" } }, 0),
    ev({ agent: "Frontend", tool: "write_file", ts: 2, input: { path: "b.tsx" } }, 1),
    ev({ agent: "Frontend", tool: "write_file", ts: 3, input: { path: "c.tsx" } }, 2),
  ];

  const out = narrate(items);
  expect(out).toHaveLength(1);
  expect(out[0]!.text).toBe("Writing a file (3)");
  expect(out[0]!.meta).toBe("c.tsx"); // shows the most recent one
});

test("narrate does not fold across different workstreams", () => {
  const items = [
    ev({ agent: "Backend", tool: "write_file", ts: 1, input: { path: "a.ts" } }, 0),
    ev({ agent: "Frontend", tool: "write_file", ts: 2, input: { path: "b.tsx" } }, 1),
  ];
  expect(narrate(items)).toHaveLength(2);
});

test("narrate reports a failed result but stays quiet about successful ones", () => {
  const items: StreamItem[] = [
    ev({ agent: "Security QA", tool: "run_command", ts: 1, type: "tool_result", status: "success" }, 0),
    ev({ agent: "Security QA", tool: "run_command", ts: 2, type: "tool_result", status: "error", summary: "tsc exited 2" }, 1),
  ];

  const out = narrate(items);
  expect(out).toHaveLength(1);
  expect(out[0]!.kind).toBe("problem");
  expect(out[0]!.meta).toBe("tsc exited 2");
});

test("describeAction phrases docker compose in user terms, not tool terms", () => {
  expect(describeAction({ agent: "Deployment", tool: "docker_compose", ts: 0, type: "tool_call", input: { action: "up" } } as ToolEvent))
    .toEqual({ text: "Bringing the app up", meta: undefined });
});

test("narrate caps its output so a long build cannot grow the panel unbounded", () => {
  const items = Array.from({ length: 300 }, (_, i) =>
    ev({ agent: i % 2 ? "Backend" : "Frontend", tool: "run_command", ts: i, input: { command: `cmd${i}` } }, i),
  );
  expect(narrate(items, 50)).toHaveLength(50);
});
