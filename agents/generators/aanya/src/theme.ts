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

export function buildThemeOverrideCss(brief: DesignBrief): string {
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

  return `:root {
  --nx-bg-base: ${bg};
  --nx-bg-elevated: ${bg};
  --nx-text: ${text};
  --nx-accent: ${accent};
  --nx-accent-text: ${accent};
  --nx-border: ${border};
  --nx-border-muted: ${border};
  --nx-ff-sans: '${brief.typography.body}', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --nx-ff-display: '${brief.typography.display}', -apple-system, BlinkMacSystemFont, sans-serif;
}
`;
}
