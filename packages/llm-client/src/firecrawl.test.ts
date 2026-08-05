import { test, expect } from "bun:test";
import { firecrawlFetchUrl } from "./firecrawl.ts";

// Phase 5 (full agentic upgrade): the Firecrawl-backed page-fetch primitive
// lives here — the lowest-level package both agents/planner and
// packages/agent-runtime/src/tools/research.ts already depend on cleanly —
// instead of duplicated in the planner (its own rootDir-isolated tsconfig
// cannot import from packages/agent-runtime at all, confirmed via a real
// TS6059 build error) and reimplemented a second time in agent-runtime.
// Only the deterministic, free-to-run paths are covered here (empty/
// malformed URL, not-configured) — never a real paid Firecrawl call,
// matching gemini.ts's geminiWebSearch test convention.

test("firecrawlFetchUrl rejects an empty URL", async () => {
  const result = await firecrawlFetchUrl("");
  expect(result.success).toBe(false);
  expect(result.error).toContain("url");
});

test("firecrawlFetchUrl rejects a malformed URL", async () => {
  const result = await firecrawlFetchUrl("not a url");
  expect(result.success).toBe(false);
  expect(result.error?.toLowerCase()).toContain("url");
});

test("firecrawlFetchUrl rejects a non-http(s) protocol", async () => {
  const result = await firecrawlFetchUrl("file:///etc/passwd");
  expect(result.success).toBe(false);
  expect(result.error?.toLowerCase()).toContain("protocol");
});

test("firecrawlFetchUrl reports not-configured when FIRECRAWL_API_KEY is unset (no network call made)", async () => {
  const previous = process.env.FIRECRAWL_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;
  try {
    const result = await firecrawlFetchUrl("https://example.com");
    expect(result.success).toBe(false);
    expect(result.error).toContain("FIRECRAWL_API_KEY");
  } finally {
    if (previous === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = previous;
  }
});
