import { firecrawlFetchUrl, type NimToolDef } from "@nexsidi/llm-client";
import type { ToolResult } from "./file.ts";

// Phase 5 (full agentic upgrade): Firecrawl's deep-page-fetch capability
// (agents/planner/src/index.ts's firecrawlFetch) was reachable ONLY from
// the planner — Saanvi, Vanya, Aanya, and the QA agents had no way to read
// a real referenced page (a user's existing company site, a design
// reference) at all, so generated content stayed lorem-ipsum-adjacent even
// when the user explicitly pointed at a real site. This wraps
// firecrawlFetchUrl (packages/llm-client/src/firecrawl.ts — the actual
// shared primitive both this file and the planner call, since the
// planner's own strict-rootDir tsconfig cannot import agent-runtime
// directly) in this tool layer's ToolResult shape. General web search is
// already unified via Gemini's native google_search grounding
// (websearch.ts's execWebSearch) — this covers the complementary case
// grounding doesn't: extracting the full clean content of ONE specific
// known URL, not a synthesized multi-source answer.
export async function execFetchUrl(args: { url: string; timeout_ms?: number }): Promise<ToolResult> {
  const result = await firecrawlFetchUrl(args.url, { timeoutMs: args.timeout_ms });

  if (!result.success) {
    return {
      status: "error",
      summary: `fetch_url: ${result.error ?? "unknown error"}`,
      ...(result.error?.includes("FIRECRAWL_API_KEY")
        ? { next_actions: ["Proceed without fetching this page, note the assumption in your summary"] }
        : {}),
    };
  }

  return {
    status: "success",
    summary: `fetched: ${result.title ?? args.url}`,
    output: result.content,
  };
}

export const FETCH_URL_TOOL_DEF: NimToolDef = {
  type: "function",
  function: {
    name: "fetch_url",
    description:
      "Fetch and read the full content of a specific known web page (e.g. a company site the user referenced, a design reference). Use this instead of guessing at content the user pointed you to — complements web_search, which answers open questions rather than reading one exact page.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full URL to fetch, e.g. https://example.com/about" },
        timeout_ms: { type: "number", description: "Request timeout in ms (default 15000)" },
      },
      required: ["url"],
    },
  },
};
