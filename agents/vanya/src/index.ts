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
import { agentChat } from "@nexsidi/llm-client";
import type { ProjectSpec } from "../../saanvi/src/index.ts";

export interface DesignBrief {
  mood: string;
  palette: Array<{ name: string; hex: string }>;
  typography: { display: string; body: string };
  layoutConcept: string;
}

export interface VanyaDeps {
  chat: typeof agentChat;
}

// A7 (established pattern — Saanvi/Arjun/QA agents): one retry on an
// empty/unparseable response before falling back. Design is NOT optional
// the way instinct memory is (Aanya genuinely needs SOME concrete brief to
// avoid slop), so the fallback below is a real, specific, non-generic
// brief in its own right — not an empty object — chosen deliberately to
// NOT be one of the well-known AI-default looks either (see FALLBACK_BRIEF).
export async function run(
  spec: ProjectSpec,
  deps: VanyaDeps = { chat: agentChat },
): Promise<DesignBrief> {
  const apiKey = process.env.NIM_API_KEY ?? "";
  const messages = [
    { role: "system" as const, content: VANYA_SYSTEM_PROMPT },
    {
      role: "user" as const,
      content: `App name: ${spec.name}\nDescription: ${spec.description}\nFeatures: ${spec.features.map((f) => f.name ?? JSON.stringify(f)).join(", ")}\n\nOutput ONLY the JSON object. No markdown, no prose.`,
    },
  ];

  let rawResult: unknown;
  try {
    const { content } = await deps.chat("vanya", messages, apiKey);
    rawResult = parseJson(content);
  } catch (firstErr) {
    console.log(`[vanya] first attempt failed (${String(firstErr)}) — retrying once`);
    try {
      const { content } = await deps.chat("vanya", messages, apiKey);
      rawResult = parseJson(content);
    } catch (secondErr) {
      console.log(`[vanya] second attempt also failed (${String(secondErr)}) — using fallback brief, not blocking generation on this`);
      return FALLBACK_BRIEF;
    }
  }

  return validateDesignBrief(rawResult) ? rawResult : FALLBACK_BRIEF;
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
  throw new Error(`[vanya] Could not parse JSON from LLM output: ${text.slice(0, 200)}`);
}

export const VANYA_SYSTEM_PROMPT = `\
You are Vanya, a senior UI/UX design lead. Given a locked product spec, produce
a CONCRETE design brief — the same compact token system a human design lead
would hand a developer before they write a single component. Your output is
implemented literally, not treated as inspiration — every value must be
specific and usable as-is.

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

Output ONLY this JSON shape:
{
  "mood": "one sentence describing the intended emotional register — confident, playful, austere, warm, technical, etc., grounded in the app's actual subject",
  "palette": [
    {"name": "string (e.g. 'ink', 'accent', 'surface')", "hex": "#RRGGBB"}
  ],
  "typography": {"display": "a specific named typeface for headings", "body": "a specific named typeface for body text"},
  "layoutConcept": "one to two sentences describing the layout system — grid density, card treatment, spacing rhythm"
}
palette must have 4-6 entries with real, distinct hex values (not near-duplicates) — include at minimum a background, a text/ink color, a primary accent, and a border/muted color. Name typefaces specifically (e.g. "Fraunces", "IBM Plex Sans") — never "sans-serif" or "a modern font".`;
