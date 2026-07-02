import { test, expect } from "bun:test";
import { translateNimToolToClaudeTool, CLAUDE_ESCALATION_MODEL, ClaudeRefusalError } from "./claude.ts";
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
  expect(CLAUDE_ESCALATION_MODEL).toBe("claude-opus-4-8");
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
