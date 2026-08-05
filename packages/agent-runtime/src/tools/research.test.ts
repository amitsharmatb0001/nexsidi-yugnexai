import { test, expect } from "bun:test";
import { execFetchUrl } from "./research.ts";

// Phase 5 (full agentic upgrade): Firecrawl's deep-page-fetch capability
// existed but was reachable ONLY from agents/planner/src/index.ts — Saanvi,
// Vanya, Aanya, and QA had no way to read a real referenced page (a user's
// existing company site, a design reference) at all. This is the shared
// tool the planner's own firecrawlFetch is rewritten to call, so there is
// one implementation, not two. Only the deterministic, free-to-run paths
// are covered here (empty input, not-configured) — never a real paid
// Firecrawl call, matching websearch.test.ts's established convention.

test("execFetchUrl rejects an empty URL", async () => {
  const result = await execFetchUrl({ url: "" });
  expect(result.status).toBe("error");
  expect(result.summary).toContain("url");
});

test("execFetchUrl rejects a malformed URL", async () => {
  const result = await execFetchUrl({ url: "not a url" });
  expect(result.status).toBe("error");
  expect(result.summary.toLowerCase()).toContain("url");
});

test("execFetchUrl reports not-configured when FIRECRAWL_API_KEY is unset (no network call made)", async () => {
  const previous = process.env.FIRECRAWL_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;
  try {
    const result = await execFetchUrl({ url: "https://example.com" });
    expect(result.status).toBe("error");
    expect(result.summary).toContain("FIRECRAWL_API_KEY");
  } finally {
    if (previous === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = previous;
  }
});

test("execFetchUrl's empty-url check runs before the FIRECRAWL_API_KEY check", async () => {
  const previous = process.env.FIRECRAWL_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;
  try {
    const result = await execFetchUrl({ url: "   " });
    expect(result.status).toBe("error");
    expect(result.summary).toContain("url");
  } finally {
    if (previous === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = previous;
  }
});
