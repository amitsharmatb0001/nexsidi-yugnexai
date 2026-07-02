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
