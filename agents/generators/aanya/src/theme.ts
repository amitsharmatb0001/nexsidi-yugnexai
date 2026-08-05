// 2026-07-28: real bug found live — every generated app's layout.tsx
// hardcoded <NexuiProvider theme="void"> as a literal string, completely
// ignoring BuildPlan.designBrief (Vanya's real per-project palette/
// typeface/mood, agents/vanya/src/index.ts). Every NexSidi-built site
// started from packages/nexui/css/nexui-tokens.css's ONE fixed dark palette
// and hardcoded 'Inter' font — real per-project variation had to fight a
// shared visual base instead of building from it. This module derives a
// real CSS custom-property override block from designBrief; the generator
// writes it to its own file and imports it after NexUI's base tokens so the
// cascade lets the project's actual colors/fonts win (see index.ts's
// scaffold: theme-overrides.css is @imported after nexui-tokens.css).
import type { DesignBrief } from "../../../vanya/src/index.ts";

function relativeLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Vanya's palette entries are freeform-named by the LLM (the prompt asks
// for "a background, a text/ink color, a primary accent, and a border/muted
// color" but doesn't enforce canonical names) — match by common keyword
// first since that's a real signal when present, fall back to relative
// luminance (darkest/lightest) when no name matches. Not full color theory;
// real, deterministic, per-project variation is the actual goal here, not
// perfect semantic classification.
function findByKeywords(palette: DesignBrief["palette"], keywords: string[]): string | null {
  for (const kw of keywords) {
    const match = palette.find((c) => c.name.toLowerCase().includes(kw));
    if (match) return match.hex;
  }
  return null;
}

// 2026-08-06: extracted the palette/font mapping into one shared function so
// buildThemeOverrideCss (kept for the pre-hydration first-paint approximation
// — see index.ts's scaffold) and buildThemeOverrideTokens (the real,
// always-correct source, passed to <NexuiProvider customTokens={...}> —
// see provider.tsx) can never drift apart into two different color choices.
function mapBriefToTokens(brief: DesignBrief): Record<string, string> {
  const palette = brief.palette;
  const sorted = [...palette].sort((a, b) => relativeLuminance(a.hex) - relativeLuminance(b.hex));
  const darkest = sorted[0]?.hex ?? "#0D1117";
  const lightest = sorted[sorted.length - 1]?.hex ?? "#E6EDF3";

  // Mood decides dark-vs-light base when no named bg/text color is found —
  // default to dark (matches NexUI's own "void" baseline) unless the mood
  // text clearly signals a light theme.
  const isLight = /\blight\b|\bbright\b|\bwarm\b|\bpaper\b|\bairy\b/i.test(brief.mood);

  const bg = findByKeywords(palette, ["background", "bg", "paper", "surface"]) ?? (isLight ? lightest : darkest);
  const text = findByKeywords(palette, ["ink", "text", "foreground", "fg"]) ?? (isLight ? darkest : lightest);
  const accentCandidate = findByKeywords(palette, ["accent", "primary", "brand"]);
  const accent = accentCandidate ?? sorted[Math.floor(sorted.length / 2)]?.hex ?? "#E89010";
  const border = findByKeywords(palette, ["border", "muted", "outline"]) ?? sorted[1]?.hex ?? sorted[0]?.hex ?? "#30363D";
  const bodyFont = `'${brief.typography.body}', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  const displayFont = `'${brief.typography.display}', -apple-system, BlinkMacSystemFont, sans-serif`;

  return {
    "--nx-bg-base": bg,
    "--nx-bg-elevated": bg,
    "--nx-text": text,
    "--nx-accent": accent,
    "--nx-accent-text": accent,
    "--nx-border": border,
    "--nx-border-muted": border,
    // --nx-ff-* controls light-DOM typography (body/headings/code — see
    // packages/nexui/src/assets/typography.ts's reset block).
    "--nx-ff-sans": bodyFont,
    "--nx-ff-display": displayFont,
    // 2026-08-06: real bug found live — NexUI's own shadow-DOM component
    // primitives (button, panel, input, etc.) read --nx-font-sans, a
    // DIFFERENT custom property from the --nx-ff-sans the typography sheet
    // uses for light-DOM text (see grep evidence: every packages/nexui/src/
    // primitives/*.ts file reads var(--nx-font-sans, ...), never --nx-ff-*).
    // Without this, a design brief's chosen body font applied to page text
    // but NexUI's own buttons/inputs/panels — a large share of the actual
    // UI surface — silently kept the default typeface regardless.
    "--nx-font-sans": bodyFont,
  };
}

export function buildThemeOverrideTokens(brief: DesignBrief): Record<string, string> {
  return mapBriefToTokens(brief);
}

// Kept for the pre-hydration first-paint approximation only (the generated
// layout.tsx still @imports this file so the page isn't unstyled/wrong-
// themed for the brief instant before NexuiProvider's client-side effect
// runs). buildThemeOverrideTokens (passed to <NexuiProvider customTokens>)
// is now the DEFINITIVE source — see provider.tsx's header comment for why
// a static CSS file alone can never reliably win against NexUI's runtime
// theme injection.
export function buildThemeOverrideCss(brief: DesignBrief): string {
  const tokens = mapBriefToTokens(brief);
  const rules = Object.entries(tokens).map(([k, v]) => `  ${k}: ${v};`).join("\n");
  return `:root {\n${rules}\n}\n`;
}
