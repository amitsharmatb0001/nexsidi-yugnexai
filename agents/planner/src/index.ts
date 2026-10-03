// Generic Planner Agent — the only agent the user interacts with directly.
//
// Conducts natural conversational discovery (like Claude Code / Codex / Antigravity),
// then calls the trigger_build tool with a complete build plan when ready.
//
// Never reveals agent names, architecture, or internal system details.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { skillPromptSection } from "../../../packages/agent-runtime/src/skill-library.ts";
import { AGENT_MODELS, MODEL_RPM_LIMITS, NIM_CONTEXT_LIMITS, waitForToken, routeToolsWithFallback, translateNimToolToGeminiTool } from "@nexsidi/llm-client";
import type { GeminiMessage, GeminiPart, NimToolDef } from "@nexsidi/llm-client";
import type { PlannerState, StreamChunk, BuildPlan, ProposedPlan, ElicitationQuestion, BuildPhase } from "./types.ts";
import { researchBrief, defaultResearchDeps, type ResearchNotes, type ResearchProgress } from "./research.ts";
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
        timeout_ms: { type: "number", description: "How long this search may run, in ms (default 120000 = 2 minutes). Ask for more when you need deep research — there is no fixed maximum." },
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
export const PROPOSE_PLAN_TOOL = {
  type: "function" as const,
  function: {
    name: "propose_plan",
    description:
      "Call this when you have gathered all information and are ready to present the plan to the user for approval. " +
      "This shows a structured plan panel — like Claude Code's plan view — where the user can Accept, Revise, or Reject. " +
      "Do NOT call trigger_build until the user explicitly accepts the plan.",
    parameters: {
      type: "object",
      required: ["appName", "context", "rules", "publicPages", "protectedPages", "dbTables", "apiEndpoints", "designDirection", "techStack", "buildPhases"],
      properties: {
        appName:    { type: "string" },
        // 2026-10-02 (Part C.1, approved by Amit): agents work in phases so
        // they do not burn out and stay relevant. The planner decides how
        // many from the app's size; every page, endpoint and table belongs to
        // exactly one phase (validatePlanPhases checks before the plan is shown).
        buildPhases: {
          type: "array",
          description:
            "The work divided into phases, in build order — as many as the app needs. Phase 1 is the foundation the rest needs " +
            "(accounts, layout, settings); each later phase is one usable piece of the product, small enough for one agent to build " +
            "in one focused session. Every page, endpoint and table of this plan appears in exactly one phase.",
          items: {
            type: "object",
            required: ["name", "goal", "pages", "endpoints", "tables"],
            properties: {
              name:      { type: "string", description: "Short phase name, e.g. \"Clients\"" },
              goal:      { type: "string", description: "What works for the user when this phase is done" },
              pages:     { type: "array", items: { type: "string" }, description: "Page paths, exactly as in publicPages/protectedPages (e.g. \"/clients/:id\")" },
              endpoints: { type: "array", items: { type: "string" }, description: "\"METHOD /path\", exactly as in apiEndpoints (e.g. \"GET /api/v1/clients\")" },
              tables:    { type: "array", items: { type: "string" }, description: "Table names, exactly as in dbTables" },
            },
          },
        },
        // 2026-10-02 (Part B.3): extras a senior team would add, from the
        // research. The customer ticks the ones they want; only those are
        // built. How many is the planner's call — no fixed count.
        suggestedFeatures: {
          type: "array",
          description:
            "Extras that would make this product genuinely better, found in your research (not asked for by the customer). " +
            "Each says why it matters. The customer ticks the ones they want; only ticked ones are built. Empty if nothing is worth suggesting.",
          items: {
            type: "object",
            required: ["name", "why", "size"],
            properties: {
              name: { type: "string", description: "Short feature name in the customer's language" },
              why:  { type: "string", description: "One line: why it matters for this product's users" },
              size: { type: "string", enum: ["small", "medium", "large"] },
            },
          },
        },
        // 2026-10-02 (Ledgerly benchmark): without this field the plan had
        // nowhere to keep "INV-2026-0001", "18%" or "Draft, Sent or Paid",
        // so the build never saw them.
        rules: {
          type: "array",
          description:
            "Every decision the customer made answering your questions, and every rule, exact format, example, rate, status name, unit and limit they gave, " +
            "copied word for word — one item each, never paraphrased (e.g. \"Invoice numbers run in order per account: INV-2026-0001, INV-2026-0002, and so on.\"). " +
            "The customer's whole brief also goes to the build word for word; these rules sit on top of it and override it where the customer decided differently.",
          items: { type: "string" },
        },
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
            // Next.js + @yugnex/core (NexUI), never Tailwind/shadcn/@radix-ui,
            // and every downstream agent already enforces that independently.
            // Fixed at the source (state the truth) rather than downstream,
            // since this field's only job is to accurately preview what will
            // actually be built.
            // 2026-09-27: was "Next.js + @yugnex/nexui-react", an old package that
            // no longer exists since the 2026-08-16 NexUI migration.
            frontend: { type: "string", description: "Always \"Next.js + @yugnex/core (NexUI components)\" — never Tailwind, shadcn/ui, or @radix-ui; those are not used on this platform." },
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
              followUp: {
                type: "object",
                description:
                  "Set this when picking this option is USELESS without one more piece of data — " +
                  "e.g. 'match existing site' needs the URL, 'have a logo' needs a link or description. " +
                  "The widget collects this value inline before the option counts as answered. " +
                  "Do NOT set this for options that are already complete on their own.",
                required: ["type", "label", "required"],
                properties: {
                  type:        { type: "string", enum: ["url", "text"] },
                  label:       { type: "string", description: "What to ask for, e.g. 'Paste the URL of the site to match'" },
                  placeholder: { type: "string" },
                  required:    { type: "boolean", description: "true if the option is meaningless without this value (almost always true when you set followUp at all)" },
                },
              },
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
export function sanitizePlan(plan: BuildPlan): BuildPlan {
  // /sign-out, /logout, /signout are never pages — sign-out is always a nav button
  const signOutPat = /^\/(sign.?out|log.?out|logout|signout)/i;
  const pages = plan.pages.filter(p => !signOutPat.test(p.path));

  // 2026-08-28: REMOVED — this block auto-added a public /sign-up page to any
  // plan with authType "jwt" and a /sign-in. Real bug found live (project
  // 3887a86155bc): the user's request said "one private login (no public
  // sign-up)", the plan SHOWN for approval correctly listed only /sign-in and
  // /admin, and then this ran AFTER approval and injected /sign-up into the
  // committed page list. The user approved one plan and a different one was
  // written to disk.
  //
  // Everything downstream then worked correctly and made it worse: Arjun's
  // reconciliation saw /sign-up among the "locked" (approved) pages and
  // guaranteed it got built; Saanvi produced a matching public registration
  // endpoint. Two rounds of prompt corrections telling Saanvi "no sign-up"
  // could not win against a page list that claimed the user had asked for it —
  // correctly, since the locked plan is meant to be authoritative.
  //
  // "Has a login" does not imply "anyone may register": an admin portal, a
  // staff tool, and a client area all have /sign-in and only the last wants
  // public sign-up. That is a product decision the user makes, not something
  // to infer from the auth type. If a project genuinely needs registration,
  // the planner lists /sign-up explicitly and the user sees it in the plan
  // they approve — which is the only way it should ever get built.
  return { ...plan, pages };
}

// ─── ProposedPlan → BuildPlan direct conversion (Bug 2 fix) ─────────────────
// When the user accepts the plan, we convert the saved ProposedPlan directly
// instead of asking the LLM to reconstruct it from a thin text summary.
export function proposedPlanToBuildPlan(proposed: ProposedPlan, acceptedSuggestions: string[] = [], brief?: string): BuildPlan {
  const allPages = [...proposed.publicPages, ...proposed.protectedPages];
  // Only suggestions the planner actually made and the customer ticked —
  // a name that was never suggested cannot be added this way.
  const ticked = new Set(acceptedSuggestions.map((n) => n.trim().toLowerCase()));
  const approvedExtras = (Array.isArray(proposed.suggestedFeatures) ? proposed.suggestedFeatures : [])
    .filter((s) => ticked.has(s.name.trim().toLowerCase()))
    .map((s) => `Also build (suggested and approved): ${s.name} — ${s.why}`);
  return {
    schemaVersion: "1",
    appName:       proposed.appName,
    appDescription: proposed.context,
    pages:         allPages,
    authType:      proposed.protectedPages.length > 0 ? "jwt" : "none",
    designNotes:   proposed.designDirection,
    rules:         [...(Array.isArray(proposed.rules) ? proposed.rules : []), ...approvedExtras],
    apiEndpoints:  Array.isArray(proposed.apiEndpoints) ? proposed.apiEndpoints : [],
    dbTables:      Array.isArray(proposed.dbTables) ? proposed.dbTables : [],
    ...(Array.isArray(proposed.buildPhases) && proposed.buildPhases.length ? { buildPhases: proposed.buildPhases } : {}),
    ...(brief?.trim() ? { brief: brief.trim() } : {}),
  };
}

const endpointKey = (e: string) => {
  const [method = "", ...rest] = e.trim().split(/\s+/);
  return `${method.toUpperCase()} ${rest.join(" ")}`;
};

/**
 * Problems with a plan's build phases, or [] when every page, endpoint and
 * table is in exactly one phase and every phase names only real items.
 * The planner fixes the plan before the customer ever sees it.
 */
export function validatePlanPhases(plan: ProposedPlan): string[] {
  const phases = Array.isArray(plan.buildPhases) ? plan.buildPhases : [];
  if (phases.length === 0) return ["buildPhases is empty — divide the work into phases (as many as the app needs)."];
  const kinds = [
    { label: "page", all: [...(plan.publicPages ?? []), ...(plan.protectedPages ?? [])].map((p) => p.path.trim()), of: (ph: BuildPhase) => ph.pages ?? [], key: (s: string) => s.trim() },
    { label: "endpoint", all: (plan.apiEndpoints ?? []).map((e) => endpointKey(`${e.method} ${e.path}`)), of: (ph: BuildPhase) => ph.endpoints ?? [], key: endpointKey },
    { label: "table", all: (plan.dbTables ?? []).map((t) => t.name.trim().toLowerCase()), of: (ph: BuildPhase) => ph.tables ?? [], key: (s: string) => s.trim().toLowerCase() },
  ];
  const problems: string[] = [];
  for (const k of kinds) {
    const where = new Map<string, string[]>();
    for (const ph of phases) for (const item of k.of(ph)) {
      const key = k.key(item);
      where.set(key, [...(where.get(key) ?? []), ph.name]);
    }
    for (const item of k.all) {
      const in_ = where.get(item) ?? [];
      if (in_.length === 0) problems.push(`${k.label} ${item} is in no phase`);
      if (in_.length > 1) problems.push(`${k.label} ${item} is in more than one phase (${in_.join(", ")})`);
    }
    for (const [item, in_] of where) {
      if (!k.all.includes(item)) problems.push(`phase ${in_.join(", ")} names ${k.label} ${item}, which is not in the plan`);
    }
  }
  return problems;
}

/**
 * The build request for the plan the user approved — every part of it, the
 * rules word for word. This text is what the spec and every later stage
 * build from (written to user-request.txt by the pipeline).
 */
export function planToUserRequest(plan: BuildPlan): string {
  const lines = [plan.appName, plan.appDescription];
  // The customer's whole brief, word for word — guaranteed by code, not left
  // to the model copying lines (a live check dropped 7 of 14 brief lines).
  if (plan.brief) {
    lines.push("", "The customer's brief (word for word):", plan.brief);
  }
  if (plan.rules?.length) {
    lines.push("", "Rules and decisions from the conversation (the customer's own words — follow exactly; where they differ from the brief, these override the brief):", ...plan.rules.map((r) => `- ${r}`));
  }
  lines.push("", ...plan.pages.map((p) => `Page: ${p.name} (${p.path}) — ${p.description}`));
  if (plan.apiEndpoints?.length) {
    lines.push("", "API endpoints:", ...plan.apiEndpoints.map((e) => `- ${e.method} ${e.path} — ${e.description}`));
  }
  if (plan.dbTables?.length) {
    lines.push("", "Data:", ...plan.dbTables.map((t) => `- ${t.name}: ${(Array.isArray(t.keyColumns) ? t.keyColumns : [String(t.keyColumns)]).join(", ")}`));
  }
  if (plan.buildPhases?.length) {
    lines.push("", "Build phases (every agent works phase by phase, in this order):");
    plan.buildPhases.forEach((ph, i) => {
      lines.push(`- Phase ${i + 1} — ${ph.name}: ${ph.goal}`);
      if (ph.pages?.length) lines.push(`  Pages: ${ph.pages.join(", ")}`);
      if (ph.endpoints?.length) lines.push(`  Endpoints: ${ph.endpoints.join(", ")}`);
      if (ph.tables?.length) lines.push(`  Tables: ${ph.tables.join(", ")}`);
    });
  }
  if (plan.designNotes) lines.push("", `Design direction: ${plan.designNotes}`);
  return lines.join("\n");
}

// Convert OpenAI-format planner messages → Gemini multi-turn format
// 2026-08-24: real bug found live — Gemini 3.x attaches a `thoughtSignature`
// to a functionCall part and REQUIRES it be echoed back verbatim on any
// later turn that replays this call in history (a hard 400 otherwise, not a
// soft degradation — see gemini.ts's GeminiPart type). The OpenAI-shaped
// tool_calls entry this function reads from now carries that signature
// (see ChatMessage.tool_calls[].thoughtSignature's header comment for the
// full root-cause writeup) — reattach it here so the reconstructed
// functionCall part matches what Gemini actually requires on replay.
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
        for (const tc of msg.tool_calls as Array<{ function: { name: string; arguments: string }; thoughtSignature?: string }>) {
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            args = {};
          }
          const part: GeminiPart = { functionCall: { name: tc.function.name, args } };
          if (tc.thoughtSignature) part.thoughtSignature = tc.thoughtSignature;
          parts.push(part);
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
  deps: { research?: (brief: string, onProgress?: (e: ResearchProgress) => void) => Promise<ResearchNotes> } = {},
): AsyncGenerator<StreamChunk> {
  // ── Fast path: user accepted the plan — convert directly without LLM ────────
  // Bug 2 fix: proposedPlan is saved by the propose_plan handler. When "build it"
  // arrives we convert it directly instead of asking the LLM to reconstruct the
  // full JSON from a thin text summary (which always fails JSON parse).
  const lastUserMsgRaw = state.messages.slice().reverse().find(m => m.role === "user")?.content ?? "";
  const lastUserMsgNorm = lastUserMsgRaw.toLowerCase().trim();
  const BUILD_TRIGGER_PHRASES = ["build it", "accept", "yes build it", "start building", "build now", "go build"];
  if (BUILD_TRIGGER_PHRASES.includes(lastUserMsgNorm) && state.proposedPlan) {
    const raw = proposedPlanToBuildPlan(state.proposedPlan, state.acceptedSuggestions ?? [], state.brief);
    const plan = sanitizePlan(raw);
    const projectId = state.sessionId;
    state.projectId = projectId;
    state.buildPlan = plan;
    state.phase = "building";
    yield { type: "build_triggered", projectId, buildPlan: plan, phase: "building" };
    return;
  }

  // ── Research first, once per session (Part B, 2 Oct 2026) ─────────────────
  // Done in code — models skip optional tools — before the first question.
  if (needsResearch(state)) {
    yield { type: "research_status", content: "Researching your product…" };
    const brief = state.messages.filter((m) => m.role === "user").map((m) => m.content ?? "").join("\n\n");
    state.brief = brief; // kept word for word for the build (planToUserRequest)
    // Each search is streamed to the chat as it starts and finishes (Amit,
    // run 4: the research used to appear as one wall of text at the end).
    const progress: ResearchProgress[] = [];
    let wake: (() => void) | null = null;
    const onProgress = (e: ResearchProgress) => { progress.push(e); wake?.(); };
    let finished = false;
    const job = (deps.research ?? ((b: string, p?: (e: ResearchProgress) => void) => researchBrief(b, { ...defaultResearchDeps, onProgress: p })))(brief, onProgress)
      .then((r) => { state.research = r; })
      .catch((err) => {
        console.error("[planner] research failed:", err);
        state.research = { notes: "", sources: [], queries: [] };
      })
      .finally(() => { finished = true; wake?.(); });
    while (!finished || progress.length > 0) {
      const next = progress.shift();
      if (next) {
        yield { type: "research_progress", progress: next };
        continue;
      }
      await new Promise<void>((resolve) => { wake = resolve; if (finished || progress.length) resolve(); });
      wake = null;
    }
    await job;
    yield { type: "research_done", research: state.research! };
  }

  // Build the running message list (mutable — tool results are appended each round)
  type Msg = { role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string; name?: string };
  const rawMessages: Msg[] = [
    { role: "system", content: buildPlannerSystemPrompt(state) },
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

  // No fixed number of rounds (decided by Amit, 2 Oct 2026): the planner
  // researches as much as a turn needs. A turn ends when the model repeats
  // an identical search (it is going in circles) or the safety time is up —
  // the user is waiting in the chat.
  const turnStarted = Date.now();
  const seenCalls = new Set<string>();

  for (let round = 0; ; round++) {
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
      // QA runs on).
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
    // 2026-08-24: see ChatMessage.tool_calls[].thoughtSignature's header
    // comment — the first functionCall part in rawParts is toolCalls[0]'s
    // real source (partsToToolCalls in gemini.ts builds toolCalls in the
    // same order it scans rawParts for "functionCall" parts), and is the
    // ONLY place this signature is available; geminiResult.toolCalls itself
    // (the { id, name, input } shape) never carries it.
    const toolCallThoughtSignature = geminiResult.rawParts.find(
      (p): p is { functionCall: { name: string; args: Record<string, unknown> }; thoughtSignature?: string } => "functionCall" in p,
    )?.thoughtSignature;

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
        yield {
          type: "elicitation_question", elicitationQuestion: question, elicitationCallId: callId, elicitationArgs: toolCallArgs,
          elicitationThoughtSignature: toolCallThoughtSignature,
        };
        // Also preserve in the local messages for if the loop continues within this same streamReply call
        messages.push({
          role: "assistant", content: textContent || null,
          tool_calls: [{ id: callId, type: "function", function: { name: "ask_user", arguments: toolCallArgs }, thoughtSignature: toolCallThoughtSignature }],
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
        // Part C.1: the phases must cover every page, endpoint and table
        // exactly once. If not, the planner fixes the plan before the
        // customer sees it.
        const phaseProblems = validatePlanPhases(plan);
        if (phaseProblems.length > 0) {
          if (plannerTurnShouldStop(seenCalls, `propose_plan ${toolCallArgs}`, turnStarted, Date.now(), PLANNER_TURN_SAFETY_MS)) {
            yield { type: "error", content: "I could not finish dividing the plan into build phases. Please ask me to try again." };
            return;
          }
          const callId = toolCallId || `call_propose_${round}`;
          messages.push({
            role: "assistant", content: textContent || null,
            tool_calls: [{ id: callId, type: "function", function: { name: "propose_plan", arguments: toolCallArgs }, thoughtSignature: toolCallThoughtSignature }],
          });
          messages.push({
            role: "tool" as const,
            content: `Plan not shown — fix the build phases and call propose_plan again:\n- ${phaseProblems.join("\n- ")}`,
            tool_call_id: callId, name: "propose_plan",
          });
          continue;
        }
        state.proposedPlan = plan;  // Bug 2 fix: save so trigger_build fast-path can use it
        yield { type: "plan_proposed", proposedPlan: plan };
        // Append the tool call + a synthetic tool result so the model knows
        // it proposed the plan and is now waiting for user feedback.
        const callId = toolCallId || `call_propose_${round}`;
        messages.push({
          role: "assistant", content: textContent || null,
          tool_calls: [{ id: callId, type: "function", function: { name: "propose_plan", arguments: toolCallArgs }, thoughtSignature: toolCallThoughtSignature }],
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
        if (state.brief) raw.brief = state.brief;
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
    if (plannerTurnShouldStop(seenCalls, `${toolCallName} ${toolCallArgs}`, turnStarted, Date.now(), PLANNER_TURN_SAFETY_MS)) {
      yield { type: "token", content: "\n\n(I have researched as far as this turn allows. Tell me more, or ask me to continue.)" };
      return;
    }

    let toolResult = "No result.";
    try {
      const args = JSON.parse(toolCallArgs) as { query?: string; url?: string; limit?: number; timeout_ms?: number };
      if (toolCallName === "web_search" && args.query) {
        const { content, sources } = await geminiWebSearch(args.query, { timeoutMs: args.timeout_ms });
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
      tool_calls: [{ id: callId, type: "function", function: { name: toolCallName, arguments: toolCallArgs }, thoughtSignature: toolCallThoughtSignature }],
    });
    messages.push({
      role: "tool" as const,
      content: toolResult,
      tool_call_id: callId,
      name: toolCallName,
    });
  }
}

const PLANNER_TURN_SAFETY_MS = Number(process.env.PLANNER_TURN_SAFETY_MINUTES ?? 15) * 60_000;

/** True when a planner turn should end: the same tool call again (going in circles) or the safety time is up. No round count. */
export function plannerTurnShouldStop(seen: Set<string>, callKey: string, startedAt: number, now: number, safetyMs: number): boolean {
  if (now - startedAt > safetyMs) return true;
  if (seen.has(callKey)) return true;
  seen.add(callKey);
  return false;
}

/** The planner researches once per session, before its first question. */
export function needsResearch(state: PlannerState): boolean {
  return !state.research;
}

/** The planner's instructions: intake rules, the research notes, and its skills. */
export function buildPlannerSystemPrompt(state: PlannerState): string {
  const research = state.research?.notes
    ? `## What you found (research done before this conversation — use it)\n\n${state.research.notes}\n\nSources: ${state.research.sources.slice(0, 20).map((s) => s.url).join(", ")}`
    : "";
  const briefText = state.messages.filter((m) => m.role === "user").map((m) => m.content ?? "").join("\n");
  return [SYSTEM_PROMPT, research, skillPromptSection("planner", briefText)].filter(Boolean).join("\n\n");
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
