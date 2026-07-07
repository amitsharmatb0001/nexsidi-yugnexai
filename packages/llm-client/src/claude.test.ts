import { test, expect } from "bun:test";
import {
  translateNimToolToClaudeTool,
  CLAUDE_ESCALATION_MODEL,
  resolveClaudeModel,
  supportsAdaptiveThinking,
  ClaudeRefusalError,
  withCacheBreakpoint,
  withLastMessageCacheBreakpoint,
} from "./claude.ts";
import type { NimToolDef } from "./nim.ts";

// Deterministic, no network — this is the required test per the task spec.
// Real API calls are never exercised in this file (that would cost money and
// requires network); agent-loop behavior against the real API is covered by
// the mandatory stress-test runs, per this codebase's existing convention
// (see websearch.test.ts / screenshot.test.ts for the same split).

test("translateNimToolToClaudeTool converts name/description/parameters -> name/description/input_schema", () => {
  const nimTool: NimToolDef = {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file in the project output directory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path" },
          content: { type: "string", description: "Full file content" },
        },
        required: ["path", "content"],
      },
    },
  };

  const claudeTool = translateNimToolToClaudeTool(nimTool);

  expect(claudeTool).toEqual({
    name: "write_file",
    description: "Write content to a file in the project output directory.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path" },
        content: { type: "string", description: "Full file content" },
      },
      required: ["path", "content"],
    },
  });
});

test("translateNimToolToClaudeTool preserves the exact input_schema object (no mutation, no wrapping)", () => {
  const parameters = { type: "object", properties: {}, required: [] };
  const nimTool: NimToolDef = {
    type: "function",
    function: { name: "noop", description: "does nothing", parameters },
  };

  const claudeTool = translateNimToolToClaudeTool(nimTool);

  expect(claudeTool.input_schema).toBe(parameters); // same reference, not a deep copy that could drift
});

test("translateNimToolToClaudeTool round-trips every real tool def shape (FILE_TOOL_DEFS-style array)", () => {
  const tools: NimToolDef[] = [
    { type: "function", function: { name: "read_file", description: "Read a file.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
    { type: "function", function: { name: "list_files", description: "List files.", parameters: { type: "object", properties: {}, required: [] } } },
  ];

  const claudeTools = tools.map(translateNimToolToClaudeTool);

  expect(claudeTools).toHaveLength(2);
  for (const t of claudeTools) {
    expect(typeof t.name).toBe("string");
    expect(typeof t.description).toBe("string");
    expect(t.input_schema).toHaveProperty("type", "object");
    // Claude's native tool format is top-level {name, description, input_schema}
    // — never nested under a "function" key like NIM's OpenAI-compatible shape.
    expect(t).not.toHaveProperty("function");
    expect(t).not.toHaveProperty("type");
  }
});

test("CLAUDE_ESCALATION_MODEL is the exact model id string with no date suffix", () => {
  expect(CLAUDE_ESCALATION_MODEL).toBe("claude-sonnet-5");
});

test("ClaudeRefusalError carries the refusal category and a readable message, distinct from a generic Error", () => {
  const err = new ClaudeRefusalError("cyber", "policy violation detected");
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe("ClaudeRefusalError");
  expect(err.category).toBe("cyber");
  expect(err.message).toContain("refusal");
  expect(err.message).toContain("cyber");
});

test("ClaudeRefusalError handles a null category/explanation (stop_details can be null-ish on some refusals)", () => {
  const err = new ClaudeRefusalError(null, null);
  expect(err.category).toBeNull();
  expect(err.message).toContain("refusal");
});

// ── Prompt caching (T7) ─────────────────────────────────────────────────────

test("withCacheBreakpoint wraps a plain string into a single text block with cache_control", () => {
  const blocks = withCacheBreakpoint("hello");
  expect(blocks).toEqual([{ type: "text", text: "hello", cache_control: { type: "ephemeral" } }]);
});

test("withCacheBreakpoint marks only the LAST block of an existing content array, leaving earlier blocks untouched", () => {
  const original: Array<{ type: string; [k: string]: unknown }> = [
    { type: "text", text: "first" },
    { type: "text", text: "second" },
  ];
  const blocks = withCacheBreakpoint(original as never);
  expect(blocks[0]).toEqual({ type: "text", text: "first" });
  expect(blocks[1]).toEqual({ type: "text", text: "second", cache_control: { type: "ephemeral" } });
});

test("withCacheBreakpoint does not mutate the input array or its blocks", () => {
  const original = [{ type: "text" as const, text: "first" }];
  const blocks = withCacheBreakpoint(original);
  expect(original[0]).not.toHaveProperty("cache_control");
  expect(blocks).not.toBe(original);
});

test("withCacheBreakpoint returns an empty array unchanged", () => {
  expect(withCacheBreakpoint([])).toEqual([]);
});

test("withCacheBreakpoint skips a trailing thinking block (cache_control is not a valid field on it)", () => {
  const blocks = withCacheBreakpoint([
    { type: "thinking", thinking: "reasoning...", signature: "sig" },
  ]);
  expect(blocks).toEqual([{ type: "thinking", thinking: "reasoning...", signature: "sig" }]);
});

test("withLastMessageCacheBreakpoint marks only the last message, leaving earlier messages' identity untouched", () => {
  const messages = [
    { role: "user" as const, content: "turn 1" },
    { role: "assistant" as const, content: "turn 2" },
    { role: "user" as const, content: "turn 3" },
  ];
  const result = withLastMessageCacheBreakpoint(messages);

  expect(result[0]).toBe(messages[0]); // untouched — same reference
  expect(result[1]).toBe(messages[1]); // untouched — same reference
  expect(result[2]).not.toBe(messages[2]); // rebuilt with cache_control
  expect(result[2]!.content).toEqual([{ type: "text", text: "turn 3", cache_control: { type: "ephemeral" } }]);
});

test("withLastMessageCacheBreakpoint on a single-message array still caches that one message", () => {
  const messages = [{ role: "user" as const, content: "only turn" }];
  const result = withLastMessageCacheBreakpoint(messages);
  expect(result[0]!.content).toEqual([{ type: "text", text: "only turn", cache_control: { type: "ephemeral" } }]);
});

test("withLastMessageCacheBreakpoint returns an empty array unchanged", () => {
  expect(withLastMessageCacheBreakpoint([])).toEqual([]);
});

test("withLastMessageCacheBreakpoint handles a tool_result content array as the last message (the runAgentWithClaude loop shape)", () => {
  const messages = [
    { role: "assistant" as const, content: "acknowledged" },
    {
      role: "user" as const,
      content: [{ type: "tool_result" as const, tool_use_id: "toolu_1", content: "{}" }],
    },
  ];
  const result = withLastMessageCacheBreakpoint(messages);
  expect(result[1]!.content).toEqual([
    { type: "tool_result", tool_use_id: "toolu_1", content: "{}", cache_control: { type: "ephemeral" } },
  ]);
});

// Vertex quota probe 2026-07-06 (scripts/ping-vertex-models.ts + Service Usage
// API): this GCP project has ZERO quota for claude-sonnet-5 on Vertex but a
// pre-granted 15,000 tokens/min for claude-opus-4-1 / claude-sonnet-4 at
// us-east5. The escalation model therefore has to be overridable per
// environment (CLAUDE_MODEL env var) without changing the direct-API default.
test("resolveClaudeModel returns the escalation default when CLAUDE_MODEL is unset", () => {
  delete process.env.CLAUDE_MODEL;
  expect(resolveClaudeModel()).toBe(CLAUDE_ESCALATION_MODEL);
});

test("resolveClaudeModel honors a CLAUDE_MODEL override", () => {
  process.env.CLAUDE_MODEL = "claude-opus-4-1";
  expect(resolveClaudeModel()).toBe("claude-opus-4-1");
  delete process.env.CLAUDE_MODEL;
});

test("resolveClaudeModel ignores a blank CLAUDE_MODEL", () => {
  process.env.CLAUDE_MODEL = "  ";
  expect(resolveClaudeModel()).toBe(CLAUDE_ESCALATION_MODEL);
  delete process.env.CLAUDE_MODEL;
});

// Adaptive thinking is only valid on Claude 4.6+ models — sending
// thinking:{type:"adaptive"} to an older override model (claude-opus-4-1,
// claude-sonnet-4) is a 400. The request builder must gate it on the model.
test("supportsAdaptiveThinking is true for the 4.6+ family and false for older models", () => {
  expect(supportsAdaptiveThinking("claude-sonnet-5")).toBe(true);
  expect(supportsAdaptiveThinking("claude-opus-4-8")).toBe(true);
  expect(supportsAdaptiveThinking("claude-sonnet-4-6")).toBe(true);
  expect(supportsAdaptiveThinking("claude-opus-4-1")).toBe(false);
  expect(supportsAdaptiveThinking("claude-sonnet-4")).toBe(false);
  expect(supportsAdaptiveThinking("claude-sonnet-4@20250514")).toBe(false);
});
