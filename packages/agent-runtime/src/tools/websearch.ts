import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_ESCALATION_MODEL, geminiWebSearch, webSearchTimeoutMs, type NimToolDef } from "@nexsidi/llm-client";
import { currentAbortSignal } from "../run-abort.ts";
import { usesClaude } from "../claude-flag.ts";
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

// 2026-07-06: Claude on Vertex is blocked project-wide by Google's
// partner-model sales gating (see packages/llm-client/src/gemini.ts's header
// comment for the live evidence) — routes through Gemini's google_search
// grounding tool instead when ESCALATION_PROVIDER=gemini, same switch used
// by the agent tool-calling loop (claude-loop.ts's resolveEscalationRunner).
async function execWebSearchViaGemini(args: { query: string; timeout_ms?: number }): Promise<ToolResult> {
  try {
    // No fixed ceiling (decided by Amit, 2 Oct 2026): default 2 minutes, the
    // agent asks for more for deep research; stopping the run ends the search.
    const { content, sources } = await geminiWebSearch(args.query, { timeoutMs: webSearchTimeoutMs(args.timeout_ms), signal: currentAbortSignal() });
    const sourceLines = sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join("\n");
    const output = [content, sourceLines ? `Sources:\n${sourceLines}` : ""].filter(Boolean).join("\n\n");
    return { status: "success", summary: `search: "${args.query}"`, output: output.slice(0, 3000) };
  } catch (err) {
    return { status: "error", summary: `web_search failed: ${String(err)}` };
  }
}

// 2026-09-28: web search is a Claude call (Anthropic's web_search tool), so it
// obeys the same CLAUDE_ENABLED feature flag as agent escalation — see
// ../claude-flag.ts. Off by default: Gemini's google_search grounding.
export function webSearchProvider(): "claude" | "gemini" {
  return usesClaude() ? "claude" : "gemini";
}

export async function execWebSearch(args: { query: string; timeout_ms?: number }): Promise<ToolResult> {
  if (!args.query.trim()) {
    return { status: "error", summary: "web_search requires a non-empty query" };
  }

  if (webSearchProvider() === "gemini") {
    return execWebSearchViaGemini(args);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      status: "error",
      summary: "web_search not configured — ANTHROPIC_API_KEY missing",
      next_actions: ["Proceed without web_search for this task, note the assumption in your summary"],
    };
  }

  const timeout = webSearchTimeoutMs(args.timeout_ms);
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
      { timeout, signal: currentAbortSignal() },
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
        timeout_ms: { type: "number", description: "How long this search may run, in ms (default 120000 = 2 minutes). Ask for more when you need deep research — there is no fixed maximum." },
      },
      required: ["query"],
    },
  },
};
