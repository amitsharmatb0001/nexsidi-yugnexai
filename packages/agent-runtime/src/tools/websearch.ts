import type { NimToolDef } from "@nexsidi/llm-client";
import type { ToolResult } from "./file.ts";

export async function execWebSearch(args: { query: string; timeout_ms?: number }): Promise<ToolResult> {
  if (!args.query.trim()) {
    return { status: "error", summary: "web_search requires a non-empty query" };
  }
  const apiUrl = process.env.WEB_SEARCH_API_URL;
  const apiKey = process.env.WEB_SEARCH_API_KEY;
  if (!apiUrl || !apiKey) {
    return {
      status: "error",
      summary: "web_search not configured — WEB_SEARCH_API_URL/KEY missing",
      next_actions: ["Proceed without web_search for this task, note the assumption in your summary"],
    };
  }

  const timeout = Math.min(args.timeout_ms ?? 10_000, 30_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: args.query }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    return { status: res.ok ? "success" : "error", summary: `search: "${args.query}"`, output: text.slice(0, 3000) };
  } catch (err) {
    clearTimeout(timer);
    return { status: "error", summary: `web_search failed: ${String(err)}` };
  }
}

export const WEB_SEARCH_TOOL_DEF: NimToolDef = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the web to verify a fact, check if a package actually exists on npm, or research current best practices before committing to an approach. Use this instead of guessing from training data.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        timeout_ms: { type: "number", description: "Request timeout in ms (default 10000)" },
      },
      required: ["query"],
    },
  },
};
