import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_ESCALATION_MODEL, type NimToolDef } from "@nexsidi/llm-client";
import type { ToolResult } from "./file.ts";

// Real server-side web search via Claude's Messages API — the `web_search`
// tool called out to an unconfigured WEB_SEARCH_API_URL/KEY that were never
// wired up; this uses ANTHROPIC_API_KEY (already present for the Claude
// escalation tier — see packages/llm-client/src/claude.ts) and the
// `web_search_20260209` server tool. Anthropic runs the search server-side —
// no client-side HTTP call to a search provider is made here at all.
const WEB_SEARCH_MAX_TOKENS = 2048;

const SEARCH_SYSTEM_PROMPT =
  "You are a research assistant helping another AI coding agent verify a " +
  "fact, check whether a package/version actually exists, or confirm a " +
  "current best practice. Use the web_search tool, then give a concise, " +
  "well-cited summary of what you found — include source URLs.";

export async function execWebSearch(args: { query: string; timeout_ms?: number }): Promise<ToolResult> {
  if (!args.query.trim()) {
    return { status: "error", summary: "web_search requires a non-empty query" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      status: "error",
      summary: "web_search not configured — ANTHROPIC_API_KEY missing",
      next_actions: ["Proceed without web_search for this task, note the assumption in your summary"],
    };
  }

  const timeout = Math.min(args.timeout_ms ?? 10_000, 30_000);
  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create(
      {
        model: CLAUDE_ESCALATION_MODEL,
        max_tokens: WEB_SEARCH_MAX_TOKENS,
        // Adaptive thinking; no temperature/top_p/top_k — see claude.ts.
        thinking: { type: "adaptive" },
        system: SEARCH_SYSTEM_PROMPT,
        messages: [{ role: "user", content: args.query }],
        // Server-side tool — Claude runs the search itself, no client
        // execution loop needed. Results arrive as web_search_tool_result
        // content blocks alongside Claude's own summarizing text.
        tools: [{ type: "web_search_20260209", name: "web_search" }],
      },
      { timeout },
    );

    // Always check stop_reason before reading content.
    if (response.stop_reason === "refusal") {
      return {
        status: "error",
        summary: `web_search refused${response.stop_details?.category ? ` (category: ${response.stop_details.category})` : ""}`,
      };
    }

    const output = summarizeWebSearchResponse(response.content);
    return { status: "success", summary: `search: "${args.query}"`, output: output.slice(0, 3000) };
  } catch (err) {
    return { status: "error", summary: `web_search failed: ${String(err)}` };
  }
}

// Walks the response content for text blocks (Claude's own summary) and
// web_search_tool_result blocks (the raw search hits), concatenating into a
// single readable summary for the calling agent.
function summarizeWebSearchResponse(content: Anthropic.Messages.ContentBlock[]): string {
  const parts: string[] = [];

  for (const block of content) {
    if (block.type === "text") {
      parts.push(block.text);
    } else if (block.type === "web_search_tool_result") {
      if (Array.isArray(block.content)) {
        const sources = block.content
          .map((r, i) => `[${i + 1}] ${r.title} — ${r.url}`)
          .join("\n");
        if (sources) parts.push(`Sources:\n${sources}`);
      } else {
        // Server-tool errors arrive as a content object, not a thrown
        // exception — e.g. { error_code: "max_uses_exceeded" }.
        parts.push(`(web_search error: ${block.content.error_code})`);
      }
    }
  }

  return parts.join("\n\n").trim() || "(no findings)";
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
