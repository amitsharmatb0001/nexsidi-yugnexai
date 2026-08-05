// Generic Planner Agent — the only agent the user interacts with directly.
//
// Conducts natural conversational discovery (like Claude Code / Codex / Antigravity),
// then calls the trigger_build tool with a complete build plan when ready.
//
// Never reveals agent names, architecture, or internal system details.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_MODELS, MODEL_RPM_LIMITS, NIM_CONTEXT_LIMITS, waitForToken, routeToolsWithFallback, translateNimToolToGeminiTool } from "@nexsidi/llm-client";
import type { GeminiMessage, GeminiPart, NimToolDef } from "@nexsidi/llm-client";
import type { PlannerState, StreamChunk, BuildPlan, ProposedPlan, ElicitationQuestion } from "./types.ts";
// Phase 5 (full agentic upgrade): the same shared primitives every other
// agent's research capability is built on — see the "web_search /
// fetch_url" call site below for why the planner's own Firecrawl-only
// implementation was retired in favor of these. (Not agent-runtime's own
// execWebSearch/execFetchUrl wrappers: the planner's tsconfig.json sets a
// strict rootDir that cannot import outside agents/planner/src at all —
// confirmed live via a TS6059 build error — so this calls the underlying
// @nexsidi/llm-client primitives directly instead of their ToolResult-
// wrapped agent-runtime versions.)
import { geminiWebSearch, firecrawlFetchUrl } from "@nexsidi/llm-client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INTAKE_RULES = readFileSync(join(__dirname, "..", "INTAKE_RULES.md"), "utf-8");

const MODEL     = AGENT_MODELS.tilotma; // qwen3-next-80b — qwen3.5-122b went 410 on 2026-07-20
const RPM       = MODEL_RPM_LIMITS[MODEL] ?? 40;
const CTX_LIMIT = NIM_CONTEXT_LIMITS[MODEL] ?? 262144;
const NIM_URL   = process.env.NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1";

// ─── Tool definitions ─────────────────────────────────────────────────────────
const WEB_SEARCH_TOOL = {
  type: "function" as const,
  function: {
    name: "web_search",
    description:
      "Search the web for information. Use when the user references a real company, website, product, or person and you need current details (team, services, branding, etc.).",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results (default 5)" },
      },
    },
  },
};

const FETCH_URL_TOOL = {
  type: "function" as const,
  function: {
    name: "fetch_url",
    description:
      "Read the content of a specific URL. Use when the user provides or mentions a URL you should read (e.g. their company website, a competitor's site, a reference page).",
    parameters: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "Full URL to fetch (must start with https://)" },
      },
    },
  },
};

// propose_plan — shows the structured plan panel before triggering the build.
// The user sees it like Claude Code's plan: Accept / Revise / Reject.
// When the user accepts, the planner calls trigger_build with the same pages.
const PROPOSE_PLAN_TOOL = {
  type: "function" as const,
  function: {
    name: "propose_plan",
    description:
      "Call this when you have gathered all information and are ready to present the plan to the user for approval. " +
      "This shows a structured plan panel — like Claude Code's plan view — where the user can Accept, Revise, or Reject. " +
      "Do NOT call trigger_build until the user explicitly accepts the plan.",
    parameters: {
      type: "object",
      required: ["appName", "context", "publicPages", "protectedPages", "dbTables", "apiEndpoints", "designDirection", "techStack"],
      properties: {
        appName:    { type: "string" },
        context:    { type: "string", description: "2-3 sentences: what this app does and who it is for" },
        publicPages: {
          type: "array",
          description: "Pages accessible without login",
          items: { type: "object", required: ["name","path","description"], properties: {
            name: { type: "string" }, path: { type: "string" }, description: { type: "string" }
          }},
        },
        protectedPages: {
          type: "array",
          description: "Pages that require the user to be logged in. Empty array if authType is none.",
          items: { type: "object", required: ["name","path","description"], properties: {
            name: { type: "string" }, path: { type: "string" }, description: { type: "string" }
          }},
        },
        dbTables: {
          type: "array",
          description: "Key database tables — just names and the 3-4 most important columns",
          items: { type: "object", required: ["name","keyColumns"], properties: {
            name: { type: "string" }, keyColumns: { type: "array", items: { type: "string" } }
          }},
        },
        apiEndpoints: {
          type: "array",
          description: "REST API endpoints the backend will expose",
          items: { type: "object", required: ["method","path","description"], properties: {
            method: { type: "string" }, path: { type: "string" }, description: { type: "string" }
          }},
        },
        designDirection: { type: "string", description: "Color palette, tone, what it should NOT look like" },
        techStack: {
          type: "object",
          required: ["frontend","backend","database","auth"],
          properties: {
            // 2026-08-05: real bug found live — this field has no enforcement
            // downstream (grepped: never read by Saanvi/Arjun/the generators,
            // it's display-only in this planner's own preview UI), but with no
            // description the model defaulted to the statistically common
            // real-world pairing ("Next.js, Tailwind CSS") — actively
            // misleading, since the mandated stack (CLAUDE.md) is
            // Next.js + @yugnex/nexui-react, never Tailwind/shadcn/@radix-ui,
            // and every downstream agent already enforces that independently.
            // Fixed at the source (state the truth) rather than downstream,
            // since this field's only job is to accurately preview what will
            // actually be built.
            frontend: { type: "string", description: "Always \"Next.js + @yugnex/nexui-react\" — never Tailwind, shadcn/ui, or @radix-ui; those are not used on this platform." },
            backend: { type: "string" },
            database: { type: "string" }, auth:     { type: "string" },
          },
        },
      },
    },
  },
};

// ask_user — emit a structured question widget to the user.
// Use BEFORE propose_plan when information is missing. Ask one question at a time.
const ASK_USER_TOOL = {
  type: "function" as const,
  function: {
    name: "ask_user",
    description:
      "Ask the user ONE structured clarifying question via a tile-based widget. " +
      "Use this when you need more information before you can create a complete plan. " +
      "Call repeatedly — one question per call — until all critical unknowns are resolved. " +
      "There is NO fixed question limit. Only call propose_plan when you have gathered everything needed.",
    parameters: {
      type: "object",
      required: ["id", "text", "type", "options"],
      properties: {
        id: { type: "string", description: "Stable short identifier, e.g. 'q_auth_scope', 'q_contact_delivery'" },
        text: { type: "string", description: "The question — clear, concise, one sentence." },
        type: { type: "string", enum: ["single", "multi"], description: "'single' for one answer (most common), 'multi' for select-all-that-apply." },
        options: {
          type: "array",
          description: "3–4 answer options. Mark one recommended:true.",
          items: {
            type: "object",
            required: ["value", "label"],
            properties: {
              value:       { type: "string" },
              label:       { type: "string", description: "Short display label (2–4 words)" },
              description: { type: "string", description: "Optional one-line clarification" },
              recommended: { type: "boolean", description: "true on the most common sensible option" },
            },
          },
        },
      },
    },
  },
};

const TRIGGER_BUILD_TOOL = {
  type: "function" as const,
  function: {
    name: "trigger_build",
    description:
      "Call this when you have enough information and the user has confirmed. " +
      "Pass the app name, description, pages, auth type, and design notes. The build pipeline handles the rest.",
    parameters: {
      type: "object",
      required: ["appName", "appDescription", "pages", "authType"],
      properties: {
        appName: {
          type: "string",
          description: "Short, clean app name (2-4 words) — use the real company/product name, not a generic placeholder",
        },
        appDescription: {
          type: "string",
          description:
            "3-5 sentence description covering: who the company/product is, the specific services or features requested, " +
            "the target audience, and what the user wants visitors/users to be able to do. " +
            "Use the company's real name and list every service/feature by name — never write 'etc.' or 'and more'.",
        },
        pages: {
          type: "array",
          description: "Every page the user asked for as a separate URL. List each page explicitly — no omissions.",
          items: {
            type: "object",
            required: ["name", "path", "description"],
            properties: {
              name:        { type: "string" },
              path:        { type: "string", description: "URL path e.g. /services/cloud-computing" },
              description: { type: "string", description: "What this page shows and what the user can do on it" },
            },
          },
        },
        authType: {
          type: "string",
          enum: ["none", "jwt"],
          description: "Use 'jwt' only when the user explicitly requested login/accounts. Use 'none' for informational/marketing sites.",
        },
        designNotes: {
          type: "string",
          description:
            "Visual direction captured from the conversation. " +
            "Include: color palette (e.g. 'dark navy #0A0E1A with electric blue #3B82F6 accents'), " +
            "tone (e.g. 'enterprise-professional, Stripe-level polish'), " +
            "any brand assets mentioned (existing logo, existing colors), " +
            "and what the design should NOT look like (e.g. 'not purple gradients over white cards'). " +
            "If the user has not specified design preferences, invent something specific and appropriate for the industry.",
        },
      },
    },
  },
};

// ─── System Prompt ──────────────────────────────────────────────────────────
// Rules live in ../INTAKE_RULES.md — edit that file, not this string.
const SYSTEM_PROMPT = `You are a senior product consultant at a software build company.
Your job: understand what the user wants to build, gather only what is genuinely missing, and hand off a clean brief.

TOOL USAGE — MANDATORY:
- To ask the user a clarifying question: call the \`ask_user\` tool. NEVER write questions as numbered text.
- To present the final plan: call the \`propose_plan\` tool.
- To start the build: call the \`trigger_build\` tool.
Questions written as text cannot be answered interactively. You MUST use the \`ask_user\` tool for every question.

FOLLOW-UP ANSWERS — CRITICAL RULE:
When the conversation history shows a previous \`ask_user\` tool call and the user just answered it,
you MUST respond by calling a tool immediately — either \`ask_user\` (next question) or \`propose_plan\` (if done).
Do NOT write any text. Do NOT repeat the summary. Do NOT ask questions as text. Call the tool directly.

You have an intake ruleset. Read it now and follow it exactly — it overrides your training defaults:

${INTAKE_RULES}`;

// ─── Goal-level token budget ─────────────────────────────────────────────────
// Token budget is determined by what this turn needs to accomplish,
// not by a fixed cap. The model stops naturally when the response is complete —
// these ceilings just prevent runaway generation, not useful output.
function goalTokens(state: PlannerState): number {
  // Always allow up to 4096 tokens so large JSON tool calls (propose_plan/trigger_build) do not get truncated mid-generation.
  return 4096;
}

// ─── BuildPlan sanitization ──────────────────────────────────────────────────
// Fixes model hallucinations that persist across all prompt iterations.
// Applied before yielding build_triggered so the pipeline always receives clean data.
function sanitizePlan(plan: BuildPlan): BuildPlan {
  // /sign-out, /logout, /signout are never pages — sign-out is always a nav button
  const signOutPat = /^\/(sign.?out|log.?out|logout|signout)/i;
  const pages = plan.pages.filter(p => !signOutPat.test(p.path));

  // jwt auth + /sign-in but no /sign-up → add /sign-up immediately after /sign-in
  if (plan.authType === "jwt") {
    const hasSignIn = pages.some(p => /^\/(sign.?in|login)$/i.test(p.path));
    const hasSignUp = pages.some(p => /^\/(sign.?up|register|signup)$/i.test(p.path));
    if (hasSignIn && !hasSignUp) {
      const idx = pages.findIndex(p => /^\/(sign.?in|login)$/i.test(p.path));
      pages.splice(idx + 1, 0, {
        name: "Sign Up",
        path: "/sign-up",
        description: "New client registration",
      });
    }
  }

  return { ...plan, pages };
}

// ─── ProposedPlan → BuildPlan direct conversion (Bug 2 fix) ─────────────────
// When the user accepts the plan, we convert the saved ProposedPlan directly
// instead of asking the LLM to reconstruct it from a thin text summary.
function proposedPlanToBuildPlan(proposed: ProposedPlan): BuildPlan {
  const allPages = [...proposed.publicPages, ...proposed.protectedPages];
  return {
    schemaVersion: "1",
    appName:       proposed.appName,
    appDescription: proposed.context,
    pages:         allPages,
    authType:      proposed.protectedPages.length > 0 ? "jwt" : "none",
    designNotes:   proposed.designDirection,
  };
}

// Convert OpenAI-format planner messages → Gemini multi-turn format
type NimMsg = { role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string; name?: string };
function nimToGemini(nimMsgs: NimMsg[]): GeminiMessage[] {
  const result: GeminiMessage[] = [];
  for (const msg of nimMsgs) {
    if (msg.role === "system") {
      result.push({ role: "system", content: msg.content ?? "" });
    } else if (msg.role === "user") {
      result.push({ role: "user", content: msg.content ?? "" });
    } else if (msg.role === "assistant") {
      if (msg.tool_calls?.length) {
        const parts: GeminiPart[] = [];
        if (msg.content) parts.push({ text: msg.content });
        for (const tc of msg.tool_calls as Array<{ function: { name: string; arguments: string } }>) {
          try {
            parts.push({ functionCall: { name: tc.function.name, args: JSON.parse(tc.function.arguments) as Record<string, unknown> } });
          } catch {
            parts.push({ functionCall: { name: tc.function.name, args: {} } });
          }
        }
        result.push({ role: "model", content: parts });
      } else {
        result.push({ role: "model", content: msg.content ?? "" });
      }
    } else if (msg.role === "tool") {
      const name = msg.name ?? "unknown";
      const content = msg.content ?? "";
      result.push({ role: "user", content: [{ functionResponse: { name, response: { output: content } } }] });
    }
  }
  return result;
}

// ─── Core: streaming chat (agentic loop — supports web_search + fetch_url) ──
export async function* streamReply(
  state: PlannerState,
  apiKey: string,
): AsyncGenerator<StreamChunk> {
  // ── Fast path: user accepted the plan — convert directly without LLM ────────
  // Bug 2 fix: proposedPlan is saved by the propose_plan handler. When "build it"
  // arrives we convert it directly instead of asking the LLM to reconstruct the
  // full JSON from a thin text summary (which always fails JSON parse).
  const lastUserMsgRaw = state.messages.slice().reverse().find(m => m.role === "user")?.content ?? "";
  const lastUserMsgNorm = lastUserMsgRaw.toLowerCase().trim();
  const BUILD_TRIGGER_PHRASES = ["build it", "accept", "yes build it", "start building", "build now", "go build"];
  if (BUILD_TRIGGER_PHRASES.includes(lastUserMsgNorm) && state.proposedPlan) {
    const raw = proposedPlanToBuildPlan(state.proposedPlan);
    const plan = sanitizePlan(raw);
    const projectId = state.sessionId;
    state.projectId = projectId;
    state.buildPlan = plan;
    state.phase = "building";
    yield { type: "build_triggered", projectId, buildPlan: plan, phase: "building" };
    return;
  }

  // Build the running message list (mutable — tool results are appended each round)
  type Msg = { role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string; name?: string };
  const rawMessages: Msg[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...state.messages.map(m => {
      // Preserve tool_calls on assistant messages (ask_user / propose_plan calls from prior turns)
      if (m.tool_calls?.length) {
        return { role: m.role, content: m.content ?? null, tool_calls: m.tool_calls };
      }
      // Preserve tool result messages (the model needs these to understand it called a tool)
      if (m.role === "tool") {
        return { role: "tool", content: m.content, tool_call_id: m.tool_call_id, name: m.name };
      }
      return { role: m.role, content: m.content };
    }),
  ];

  // Deduplicate consecutive same-role messages (only for user messages — never merge tool or assistant-with-tool-calls)
  const messages: Msg[] = [];
  for (const msg of rawMessages) {
    const last = messages[messages.length - 1];
    const canMerge = last &&
      last.role === msg.role &&
      msg.role === "user" &&        // only merge user messages
      !last.tool_calls &&           // never merge tool_call messages
      !msg.tool_calls;
    if (canMerge) {
      last.content = last.content && msg.content
        ? `${last.content}\n\n${msg.content}`
        : (last.content ?? msg.content);
    } else {
      messages.push({ ...msg });
    }
  }

  const MAX_TOOL_ROUNDS = 6; // max web-search rounds before forcing a reply

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Convert accumulated messages to Gemini format and call the model
    const geminiMsgs = nimToGemini(messages);
    const geminiTools = [ASK_USER_TOOL, WEB_SEARCH_TOOL, FETCH_URL_TOOL, PROPOSE_PLAN_TOOL, TRIGGER_BUILD_TOOL]
      .map(t => translateNimToolToGeminiTool(t as NimToolDef));

    let geminiResult;
    try {
      // 2026-07-24 (W0.2)/2026-07-25 (Phase 1, full MVP upgrade): this call
      // handles BOTH simple chat turns (ask_user chit-chat) AND the actual
      // propose_plan JSON that becomes the locked feature/page manifest —
      // one tier covers the whole loop. Verified live (audit-2026-07-25.md,
      // A.3): running this on "user" (gemini-2.5-flash-lite, LOW thinking)
      // is the confirmed root cause of nextech8 shipping without its
      // requested Vision and Mission pages — the cheapest model in the
      // fleet was deciding the manifest every downstream stage trusts.
      // Moved to "plan" (gemini-3.1-pro-preview, HIGH thinking, same pool
      // QA runs on) — bounded to MAX_TOOL_ROUNDS=6 above, so the cost
      // increase is capped, not unbounded.
      geminiResult = await routeToolsWithFallback("plan", geminiMsgs, geminiTools);
    } catch (geminiErr) {
      console.error(`[planner] gemini error (round ${round}):`, geminiErr);
      yield { type: "error", content: "Model unavailable. Please try again." };
      return;
    }

    const textContent  = geminiResult.content;
    const toolCallName = geminiResult.toolCalls[0]?.name ?? "";
    const toolCallArgs = geminiResult.toolCalls[0] ? JSON.stringify(geminiResult.toolCalls[0].input) : "";
    const toolCallId   = geminiResult.toolCalls[0]?.id ?? `call_${round}`;

    // No tool call → pure text response, emit and done
    if (!geminiResult.toolCalls.length) {
      if (textContent) yield { type: "token", content: textContent };
      return;
    }

    // ── ask_user → emit elicitation question widget, pause for user answer ────
    if (toolCallName === "ask_user" && toolCallArgs.trim()) {
      try {
        const question = JSON.parse(toolCallArgs) as ElicitationQuestion;
        const callId = toolCallId || `call_ask_${round}`;
        // Emit with callId + raw args so chat.ts can persist proper tool_call context in the session.
        // Without this, the next turn rebuilds messages without tool_call structure and the model
        // reverts to text Q&A instead of calling ask_user/propose_plan again.
        yield { type: "elicitation_question", elicitationQuestion: question, elicitationCallId: callId, elicitationArgs: toolCallArgs };
        // Also preserve in the local messages for if the loop continues within this same streamReply call
        messages.push({
          role: "assistant", content: textContent || null,
          tool_calls: [{ id: callId, type: "function", function: { name: "ask_user", arguments: toolCallArgs } }],
        });
        messages.push({
          role: "tool" as const,
          content: "Question shown to user as an interactive widget. Waiting for their answer.",
          tool_call_id: callId, name: "ask_user",
        });
        return; // pause — the user's answer arrives as the next user message
      } catch {
        yield { type: "error", content: "Failed to parse question. Please continue." };
      }
      return;
    }

    // ── propose_plan → emit plan panel event, loop continues for Accept/Revise ─
    if (toolCallName === "propose_plan" && toolCallArgs.trim()) {
      try {
        const plan = JSON.parse(toolCallArgs) as ProposedPlan;
        state.proposedPlan = plan;  // Bug 2 fix: save so trigger_build fast-path can use it
        yield { type: "plan_proposed", proposedPlan: plan };
        // Append the tool call + a synthetic tool result so the model knows
        // it proposed the plan and is now waiting for user feedback.
        const callId = toolCallId || `call_propose_${round}`;
        messages.push({
          role: "assistant", content: textContent || null,
          tool_calls: [{ id: callId, type: "function", function: { name: "propose_plan", arguments: toolCallArgs } }],
        });
        messages.push({
          role: "tool" as const, content: "Plan shown to user. Wait for their response: 'build it' to start, or they will describe changes.",
          tool_call_id: callId, name: "propose_plan",
        });
        // Return here — wait for next user message (Accept / Revise feedback)
        return;
      } catch {
        yield { type: "error", content: "Failed to parse plan. Please try again." };
      }
      return;
    }

    // ── trigger_build → fire and exit ────────────────────────────────────────
    if (toolCallName === "trigger_build" && toolCallArgs.trim()) {
      try {
        const raw = JSON.parse(toolCallArgs) as BuildPlan;
        raw.schemaVersion = "1";
        const plan = sanitizePlan(raw);
        const projectId = state.sessionId;
        state.projectId = projectId;
        state.buildPlan = plan;
        state.phase     = "building";
        yield { type: "build_triggered", projectId, buildPlan: plan, phase: "building" };
      } catch {
        yield { type: "error", content: "Failed to parse build specification. Please try again." };
      }
      return;
    }

    // ── web_search / fetch_url → execute and loop ─────────────────────────────
    // Phase 5 (full agentic upgrade): was the planner's own Firecrawl-only
    // implementation (firecrawlSearch/firecrawlFetch, since deleted) — a
    // second, duplicate research path alongside the shared primitives every
    // other agent's research capability is built on. web_search now uses
    // Gemini's native google_search grounding directly (the "default for
    // factual grounding" the plan calls for); fetch_url uses the same
    // Firecrawl-backed firecrawlFetchUrl Aanya and Saanvi now use via
    // agent-runtime's wrapper — one real implementation each, not three.
    let toolResult = "No result.";
    try {
      const args = JSON.parse(toolCallArgs) as { query?: string; url?: string; limit?: number };
      if (toolCallName === "web_search" && args.query) {
        const { content, sources } = await geminiWebSearch(args.query);
        const sourceLines = sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join("\n");
        toolResult = [content, sourceLines ? `Sources:\n${sourceLines}` : ""].filter(Boolean).join("\n\n") || "No results found.";
      } else if (toolCallName === "fetch_url" && args.url) {
        const result = await firecrawlFetchUrl(args.url);
        toolResult = result.success && result.content ? result.content : (result.error ?? "Could not fetch the page.");
      }
    } catch (err) {
      toolResult = `Tool error: ${String(err)}`;
    }

    // Append assistant turn (with tool call) + tool result so next round has context
    const callId = toolCallId || `call_${round}`;
    messages.push({
      role: "assistant",
      content: textContent || null,
      tool_calls: [{ id: callId, type: "function", function: { name: toolCallName, arguments: toolCallArgs } }],
    });
    messages.push({
      role: "tool" as const,
      content: toolResult,
      tool_call_id: callId,
      name: toolCallName,
    });
  }

  // Hit max rounds — model never finished, yield a fallback
  yield { type: "token", content: "\n\n(Research limit reached. Please tell me more directly and I'll proceed.)" };
}

// ─── Stage notifications (called by pipeline route to push updates to chat) ──
export function stageMessage(stage: string): string {
  const messages: Record<string, string> = {
    spec:      "Planning how to build this for you...",
    decompose: "Working out the build details...",
    generate:  "Writing your code. This usually takes 2-4 minutes.",
    qa:        "Running quality checks...",
    qa_fix:    "Found some improvements to make.",
    live_test: "Testing the live app...",
    deliver:   "Almost done — packaging everything up.",
    done:      "Your app is ready.",
  };
  return messages[stage] ?? "Working on it...";
}
