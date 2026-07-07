import { test, expect } from "bun:test";
import { execWebSearch } from "./websearch.ts";

// execWebSearch now calls Claude's real web_search_20260209 server tool
// (see websearch.ts) using ANTHROPIC_API_KEY — the old
// WEB_SEARCH_API_URL/WEB_SEARCH_API_KEY env vars are gone. These tests only
// cover the deterministic, free-to-run paths (empty query, not-configured);
// they never make a real paid API call.

test("execWebSearch rejects an empty query", async () => {
  const result = await execWebSearch({ query: "" });
  expect(result.status).toBe("error");
  expect(result.summary).toContain("query");
});

test("execWebSearch reports not-configured when ANTHROPIC_API_KEY is unset (no network call made)", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const result = await execWebSearch({ query: "does npm package left-pad exist" });
    expect(result.status).toBe("error");
    expect(result.summary).toContain("ANTHROPIC_API_KEY");
    expect(result.summary).not.toContain("WEB_SEARCH_API_URL");
    expect(result.summary).not.toContain("WEB_SEARCH_API_KEY");
  } finally {
    if (previous === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previous;
    }
  }
});

test("execWebSearch's empty-query check runs before the ANTHROPIC_API_KEY check", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const result = await execWebSearch({ query: "   " }); // whitespace-only
    expect(result.status).toBe("error");
    expect(result.summary).toContain("query");
  } finally {
    if (previous === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previous;
    }
  }
});

// 2026-07-06: Claude on Vertex is blocked by Google's partner-model sales
// gating project-wide (see packages/llm-client/src/gemini.ts's header
// comment) — ESCALATION_PROVIDER=gemini routes web_search through Gemini's
// google_search grounding tool instead of Claude's web_search_20260209
// server tool, matching the same switch used by the agent tool-calling loop
// (packages/agent-runtime/src/claude-loop.ts's resolveEscalationRunner).
test("execWebSearch routes to Gemini and reports not-configured on GOOGLE_CLOUD_PROJECT (not ANTHROPIC_API_KEY) when ESCALATION_PROVIDER=gemini", async () => {
  const previousProvider = process.env.ESCALATION_PROVIDER;
  const previousProject = process.env.GOOGLE_CLOUD_PROJECT;
  process.env.ESCALATION_PROVIDER = "gemini";
  delete process.env.GOOGLE_CLOUD_PROJECT;
  try {
    const result = await execWebSearch({ query: "does npm package left-pad exist" });
    expect(result.status).toBe("error");
    expect(result.summary).toContain("GOOGLE_CLOUD_PROJECT");
    expect(result.summary).not.toContain("ANTHROPIC_API_KEY");
  } finally {
    if (previousProvider === undefined) delete process.env.ESCALATION_PROVIDER;
    else process.env.ESCALATION_PROVIDER = previousProvider;
    if (previousProject === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = previousProject;
  }
});

test("execWebSearch still uses the Claude path (ANTHROPIC_API_KEY check) when ESCALATION_PROVIDER is unset", async () => {
  const previousProvider = process.env.ESCALATION_PROVIDER;
  const previousKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ESCALATION_PROVIDER;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const result = await execWebSearch({ query: "does npm package left-pad exist" });
    expect(result.status).toBe("error");
    expect(result.summary).toContain("ANTHROPIC_API_KEY");
  } finally {
    if (previousProvider === undefined) delete process.env.ESCALATION_PROVIDER;
    else process.env.ESCALATION_PROVIDER = previousProvider;
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  }
});
