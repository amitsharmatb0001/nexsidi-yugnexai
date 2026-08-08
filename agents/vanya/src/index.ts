// Vanya — UI/UX design identity (P3.W3.1, full agentic upgrade, 2026-07-24).
//
// Before this file: Vanya had NO CODE AT ALL (confirmed via repo-wide grep
// during this session's forensic audit). Aanya's generation prompt already
// has real anti-slop instructions ("Do NOT produce: purple gradients on
// white cards... DO produce: a distinct visual identity") but nothing
// concrete to implement them WITH — the "APP-SPECIFIC VISUAL IDENTITY"
// section it injects is just `plan.appDescription`, Saanvi's one-paragraph
// requirements text. Saanvi's job is requirements gathering, not visual
// design — asking it to also imply a color palette and typeface pairing is
// exactly how every run ends up reaching for the same generic defaults.
//
// This is that missing step: takes the locked ProjectSpec and produces a
// concrete, specific design brief (named hex palette, a real typeface
// pairing, a layout concept, a mood) — the same kind of compact token
// system a human design lead would hand a developer before they write a
// single component. Wired into Arjun's run() (agents/arjun/src/index.ts)
// so BuildPlan.designBrief reaches Aanya alongside the API contract.
//
// 2026-08-08: real gap found live, explicit user request (project
// bae438767bed) — this file was a single raw one-shot agentChat() call
// with NO tools at all, fed nothing but the spec's own paragraph. It could
// not research anything, and — separately — never went through the shared
// agent loop, so it never got assembleSystemPrompt's skill-doctrine
// injection either (no vanya.md existed to load anyway; see
// packages/agent-runtime/skills/vanya.md, added alongside this rewrite).
// Confirmed live: this produced one uniform, generic palette+typeface pair
// applied identically to every page, the direct root cause behind a
// delivered app scoring 9.15/10 on a live-quality check while still
// looking, in the user's own words, "like a jr dev build." Rewritten to
// run through runAgentEscalated (the real loop) with enableWebSearch, so
// Vanya can ground decisions in something researched rather than guessed,
// and so its doctrine actually loads.
import { runAgentEscalated } from "@nexsidi/agent-runtime";
import { AGENT_MODELS, FALLBACK_CHAIN } from "@nexsidi/llm-client";
import type { ProjectSpec } from "../../saanvi/src/index.ts";

export interface DesignBrief {
  mood: string;
  palette: Array<{ name: string; hex: string }>;
  typography: { display: string; body: string };
  layoutConcept: string;
}

export interface VanyaDeps {
  runAgent: typeof runAgentEscalated;
}

// Design is NOT optional the way instinct memory is (Aanya genuinely needs
// SOME concrete brief to avoid slop), so the fallback below is a real,
// specific, non-generic brief in its own right — not an empty object —
// chosen deliberately to NOT be one of the well-known AI-default looks
// either (see FALLBACK_BRIEF). Any failure mode (unparseable output, the
// agent loop exhausting its iteration budget, an escalation failure) falls
// back to it rather than blocking generation entirely — the retry logic
// that used to live here manually is now runAgentEscalated's own job
// (NIM-path retry, one-time Claude escalation), so this function only
// needs to handle "the whole call didn't produce a usable brief."
const VANYA_MAX_ITERATIONS = 15;

export async function run(
  spec: ProjectSpec,
  deps: VanyaDeps = { runAgent: runAgentEscalated },
): Promise<DesignBrief> {
  const apiKey = process.env.NIM_API_KEY ?? "";

  let result;
  try {
    result = await deps.runAgent({
      agentName: "vanya",
      model: AGENT_MODELS.vanya,
      fallbackModels: FALLBACK_CHAIN.vanya,
      apiKey,
      systemPrompt: VANYA_SYSTEM_PROMPT,
      initialMessage: buildVanyaTask(spec),
      sandboxDir: process.cwd(),
      enableWebSearch: true,
      // Same D26 reasoning applied to Tier 3/live-eval elsewhere this
      // session — a design-brief step is planning, not fixing. It never
      // writes project files (Aanya implements the brief, not Vanya).
      readOnly: true,
      maxIterations: VANYA_MAX_ITERATIONS,
    });
  } catch (err) {
    console.log(`[vanya] agent run failed (${String(err)}) — using fallback brief, not blocking generation on this`);
    return FALLBACK_BRIEF;
  }

  const rawResult = parseJson(result.summary);
  if (rawResult === undefined) {
    console.log(`[vanya] could not parse a brief from the agent's output — using fallback brief, not blocking generation on this`);
    return FALLBACK_BRIEF;
  }

  return validateDesignBrief(rawResult) ? rawResult : FALLBACK_BRIEF;
}

export function buildVanyaTask(spec: ProjectSpec): string {
  return `App name: ${spec.name}
Description: ${spec.description}
Features: ${spec.features.map((f) => f.name ?? JSON.stringify(f)).join(", ")}

Research this app's actual domain per your system prompt before deciding on a
brief, then end task_complete's summary with EXACTLY the JSON object your
system prompt specifies — no markdown fence, no prose after it.`;
}

// Exported for direct testing — a malformed/incomplete response must fall
// back to FALLBACK_BRIEF, never a half-populated object that would crash
// formatDesignBriefForPrompt or silently omit a section Aanya expects.
export function validateDesignBrief(value: unknown): value is DesignBrief {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.mood !== "string" || !v.mood) return false;
  if (!Array.isArray(v.palette) || v.palette.length < 3) return false;
  if (!v.palette.every((c) => c && typeof c === "object" && typeof (c as any).name === "string" && /^#[0-9a-fA-F]{3,8}$/.test((c as any).hex ?? ""))) return false;
  if (!v.typography || typeof v.typography !== "object") return false;
  const typo = v.typography as Record<string, unknown>;
  if (typeof typo.display !== "string" || typeof typo.body !== "string" || !typo.display || !typo.body) return false;
  if (typeof v.layoutConcept !== "string" || !v.layoutConcept) return false;
  return true;
}

// A deliberately specific, non-generic fallback — chosen to NOT be one of
// the well-documented AI-default looks (not warm-cream-serif-terracotta,
// not near-black-with-neon-accent, not a purple gradient). Used only when
// the model fails twice; still gives Aanya something concrete to implement
// rather than nothing.
export const FALLBACK_BRIEF: DesignBrief = {
  mood: "Confident and precise — a technical product that trusts its own substance, not decoration.",
  palette: [
    { name: "ink", hex: "#14171F" },
    { name: "paper", hex: "#F6F5F1" },
    { name: "accent", hex: "#2F6F4F" },
    { name: "accent-muted", hex: "#8FB5A0" },
    { name: "border", hex: "#D8D5CC" },
  ],
  typography: { display: "Söhne (fallback: system-ui)", body: "Charter (fallback: Georgia, serif)" },
  layoutConcept: "Dense, grid-aligned sections with generous internal padding and a single consistent card treatment — no floating decorative shapes.",
};

// Pure formatter — the text block injected into Aanya's generation prompt.
// Exported and unit-tested directly (same convention as tier3-review's
// buildEvidenceCollectorTask / live-eval's buildLiveEvalTask).
export function formatDesignBriefForPrompt(brief: DesignBrief): string {
  const paletteLines = brief.palette.map((c) => `  - ${c.name}: ${c.hex}`).join("\n");
  return `DESIGN IDENTITY (locked by Vanya — implement exactly, do not substitute generic defaults):
Mood: ${brief.mood}
Palette:
${paletteLines}
Typography: display face "${brief.typography.display}", body face "${brief.typography.body}"
Layout concept: ${brief.layoutConcept}
Every primary Button/accent element uses the "accent" color above. Every surface uses "paper"/"ink" per theme. Do not introduce colors outside this palette.`;
}

// Returns undefined (not a throw) on failure — the caller's job is deciding
// what "no usable brief" means (FALLBACK_BRIEF), not this pure parser's.
function parseJson(text: string): unknown {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch?.[1]) {
    try { return JSON.parse(fenceMatch[1]); } catch { /* fall through */ }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
  }
  return undefined;
}

export const VANYA_SYSTEM_PROMPT = `\
You are Vanya, a senior UI/UX design lead. Given a locked product spec, produce
a CONCRETE design brief — the same compact token system a human design lead
would hand a developer before they write a single component. Your output is
implemented literally, not treated as inspiration — every value must be
specific and usable as-is.

RESEARCH BEFORE YOU DECIDE. Use web_search to look up 1-3 real reference points
for this app's actual domain — what does a real business in this exact
industry look like, what visual conventions does this market genuinely use.
Ground your decisions in something researched, not a template guess at
"professional" or "modern." You are read-only — you do not write files.

AVOID THESE WELL-KNOWN AI-GENERATED DEFAULTS — do not reach for them unless the
spec's own subject matter genuinely calls for it:
- Purple-to-blue gradient hero on a white background
- Warm cream (#F4F1EA) with a serif display face and a terracotta accent
- Near-black background with a single acid-green or neon-violet accent
- Inter or Space Grotesk as the "safe" typeface choice
- Centered-everything layouts, rounded-lg on every card, emoji as section markers

Instead, ground every decision in the SPECIFIC subject of this app — its
audience, its domain, what it actually does — not a generic "modern SaaS" look.

IF THE SPEC ALREADY NAMES LITERAL COLORS AND THEIR ROLES — real bug found
live: given a spec whose description said "deep midnight blue (#0B1021)
background with off-white (#F8F9FA) content", a prior run correctly copied
both exact hex values into the palette but SWAPPED their roles — labeled
the off-white color "background" and the midnight blue "ink", producing a
light theme when a dark one was explicitly specified. When the spec's own
text pairs a specific hex code with a specific role (background, text,
accent, etc.), that pairing is a REQUIREMENT, not a suggestion — preserve
it exactly. Only invent your own role assignment when the spec names
colors without specifying which role each one plays.

ONE UNIFORM LOOK APPLIED TO EVERY PAGE READS AS TEMPLATED, EVEN WHEN EACH PAGE
IS COMPETENTLY BUILT. Your layoutConcept must describe how visual EMPHASIS
shifts by page purpose within the same system — a marketing/landing page
carries more weight (persuasion), an auth page carries less (speed, low
friction), a dashboard carries a different kind again (density, scannability).
Same palette and type family throughout; different emphasis per page type.

Call task_complete when done. End its "summary" with EXACTLY this JSON shape
and nothing after it — no markdown fence, no trailing prose:
{
  "mood": "one sentence describing the intended emotional register — confident, playful, austere, warm, technical, etc., grounded in the app's actual subject",
  "palette": [
    {"name": "string (e.g. 'ink', 'accent', 'surface')", "hex": "#RRGGBB"}
  ],
  "typography": {"display": "a specific named typeface for headings", "body": "a specific named typeface for body text"},
  "layoutConcept": "one to two sentences describing the layout system — grid density, card treatment, spacing rhythm, and how emphasis shifts by page type"
}
palette must have 4-6 entries with real, distinct hex values (not near-duplicates) — include at minimum a background, a text/ink color, a primary accent, and a border/muted color. Name typefaces specifically (e.g. "Fraunces", "IBM Plex Sans") — never "sans-serif" or "a modern font".

BE EFFICIENT — you have a limited tool-call budget. 1-3 web_search calls, brief
reasoning, then call task_complete. Reaching the budget without calling
task_complete means your brief is LOST and generation falls back to a generic
default, so wrap up in time.`;
