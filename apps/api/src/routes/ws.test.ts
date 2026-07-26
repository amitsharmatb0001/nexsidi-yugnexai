import { test, expect } from "bun:test";
import { sanitizePipelineEvent } from "./ws.ts";

// 2026-07-25 (Phase 6, full MVP upgrade): real confidentiality leak found
// live while verifying Layer 7 — /ws/pipeline/:projectId was forwarding
// events.jsonl verbatim, including the raw internal agent name
// ("shubham", "navya", "karan", ...) CLAUDE.md's CONFIDENTIALITY RULE says
// must never appear in any user-facing interface. No test existed for this
// route at all before this.

test("sanitizePipelineEvent replaces a raw internal agent name with a public label", () => {
  const result = sanitizePipelineEvent({ ts: 123, agent: "shubham", type: "tool_call", tool: "write_file" }) as Record<string, unknown>;
  expect(result.agent).toBe("Backend");
  expect(result.agent).not.toBe("shubham");
});

test("sanitizePipelineEvent covers every real roster agent, never leaks the raw name", () => {
  const roster = ["saanvi", "arjun", "shubham", "aanya", "pranav", "navya", "karan", "deepika", "riya", "tilotma"];
  for (const agent of roster) {
    const result = sanitizePipelineEvent({ agent, type: "tool_call" }) as Record<string, unknown>;
    expect(result.agent).not.toBe(agent);
    expect(typeof result.agent).toBe("string");
  }
});

test("sanitizePipelineEvent strips a spawned subagent's free-text suffix, still maps the base agent", () => {
  const result = sanitizePipelineEvent({ agent: "shubham-researcher", type: "tool_call" }) as Record<string, unknown>;
  expect(result.agent).toBe("Backend");
  expect(result.agent).not.toContain("researcher");
});

test("sanitizePipelineEvent falls back to a generic label for an unrecognized agent name rather than passing it through", () => {
  const result = sanitizePipelineEvent({ agent: "some-future-agent", type: "tool_call" }) as Record<string, unknown>;
  expect(result.agent).toBe("Build Agent");
});

test("sanitizePipelineEvent preserves non-confidential fields (tool, path, status)", () => {
  const result = sanitizePipelineEvent({ agent: "aanya", type: "tool_result", tool: "write_files", status: "success", path: "app/page.tsx" }) as Record<string, unknown>;
  expect(result.type).toBe("tool_result");
  expect(result.tool).toBe("write_files");
  expect(result.status).toBe("success");
  expect(result.path).toBe("app/page.tsx");
});

test("sanitizePipelineEvent passes through a malformed/non-object event unchanged rather than throwing", () => {
  expect(sanitizePipelineEvent(null)).toBe(null);
  expect(sanitizePipelineEvent("raw string log line")).toBe("raw string log line");
  expect(sanitizePipelineEvent({ type: "log", content: "no agent field here" })).toEqual({ type: "log", content: "no agent field here" });
});
