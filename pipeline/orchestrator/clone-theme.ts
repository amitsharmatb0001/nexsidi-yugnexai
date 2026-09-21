// Deterministic accent-color variation for the clone flow (2026-09-01, real
// user request): "user will never get to see the same website with just the
// name changed only... if [the source] has green then we change to blue, so
// they don't look identical." A rename-only clone leaves every color exactly
// as the source had it — two clones shown side by side (the actual portfolio
// use case this whole flow exists for) would visibly read as the same
// template. This always runs, independent of whether an LLM `changes`
// request was made — varying the accent is mechanical, not a judgment call,
// so it costs zero LLM tokens and never depends on the optional edit pass.
//
// Scoped deliberately to ONLY the primary/ring accent (not background/
// foreground/border): that's the single color that most defines a site's
// visual identity, and touching it is self-contained — background/
// foreground changes risk contrast problems elsewhere the theme system
// doesn't independently re-verify. Only works against the current
// @yugnex/core createTheme() system (see agents/generators/aanya/src/
// theme.ts) — a project still on the old @yugnex/nexui-react system (raw
// --nx-* CSS vars, e.g. NexTech) has no createTheme() call to find, and this
// skips cleanly rather than guessing at a different file shape.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { contrastColor } from "../../agents/generators/aanya/src/theme.ts";

export function hexHue(hex: string): number {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0; // grayscale — no real hue to report
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

export function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// Curated, not hue-rotated — a blind HSL rotation can land on a muddy or
// clashing hue; every entry here is a deliberately chosen, professional,
// sufficiently-saturated color. Purple/violet excluded on purpose — it's
// the exact family the "no purple gradients" AI-slop rule (aanya's own
// system prompt, karan.md, tier3-review.ts) watches for; better to never
// risk reintroducing it via an unrelated mechanism.
export const CLONE_ACCENT_PALETTE = [
  "#FF3B00", // vermillion
  "#2563EB", // blue
  "#059669", // emerald
  "#D97706", // amber
  "#DC2626", // red
  "#0891B2", // cyan
  "#65A30D", // olive
  "#DB2777", // magenta
] as const;

// Below this, two hues read as "basically the same color" at a glance —
// picking one this close to the source would defeat the entire point.
const MIN_HUE_SEPARATION_DEG = 40;

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h;
}

// Deterministic: same (source, seed) always picks the same color, so a
// re-run or a resumed workflow doesn't shuffle the clone's identity. Seeded
// on the NEW project's own id — different clones from the same source
// therefore land on different accents from each other too, not just from
// the source.
export function pickDistinctAccent(sourceAccent: string, seed: string): string {
  const sourceHue = hexHue(sourceAccent);
  const distinct = CLONE_ACCENT_PALETTE.filter((c) => hueDistance(hexHue(c), sourceHue) >= MIN_HUE_SEPARATION_DEG);
  const pool = distinct.length > 0 ? distinct : CLONE_ACCENT_PALETTE;
  return pool[hashSeed(seed) % pool.length]!;
}

// createTheme({...}) is generated as JSON.stringify(tokens, null, 2) spliced
// directly after the call (confirmed against a real generated layout.tsx,
// ac85eb0fa344/frontend/app/layout.tsx) — so the object body is valid JSON
// and can be parsed directly rather than hand-rolled with regex replacement
// on individual keys.
const THEME_CALL_RE = /const projectTheme = createTheme\((\{[\s\S]*?\})\);/;

export function shiftThemeAccent(layoutContent: string, newAccent: string): string | null {
  const match = layoutContent.match(THEME_CALL_RE);
  const body = match?.[1];
  if (!body) return null;

  let theme: { light?: Record<string, string>; dark?: Record<string, string> };
  try {
    theme = JSON.parse(body);
  } catch {
    return null;
  }

  const primaryForeground = contrastColor(newAccent);
  for (const mode of ["light", "dark"] as const) {
    const block = theme[mode];
    if (!block) continue;
    block.primary = newAccent;
    block.ring = newAccent;
    block.primaryForeground = primaryForeground;
  }

  // JSON.parse preserves source key order, and only existing keys are
  // mutated above (none added/removed) — re-stringifying reproduces the
  // original's exact key order and 2-space indent, so the diff is limited
  // to the 6 changed values (primary/ring/primaryForeground × 2 modes).
  return layoutContent.replace(THEME_CALL_RE, `const projectTheme = createTheme(${JSON.stringify(theme, null, 2)});`);
}

export interface ApplyThemeVariationResult {
  applied: boolean;
  newAccent?: string;
  reason?: string;
}

export interface ApplyThemeVariationDeps {
  readFn?: (path: string) => string;
  writeFn?: (path: string, content: string) => void;
  existsFn?: (path: string) => boolean;
}

export function applyThemeVariation(
  buildDir: string,
  seed: string,
  deps: ApplyThemeVariationDeps = {},
): ApplyThemeVariationResult {
  const readFn = deps.readFn ?? ((p: string) => readFileSync(p, "utf-8"));
  const writeFn = deps.writeFn ?? ((p: string, c: string) => writeFileSync(p, c, "utf-8"));
  const existsFn = deps.existsFn ?? existsSync;

  const layoutPath = join(buildDir, "frontend", "app", "layout.tsx");
  if (!existsFn(layoutPath)) {
    return { applied: false, reason: "no app/layout.tsx found" };
  }

  const content = readFn(layoutPath);
  const sourceAccentMatch = content.match(/"primary":\s*"(#[0-9a-fA-F]{3,6})"/);
  // No real source signal to steer away from (e.g. old-system project that
  // happens to still hit this far) — any palette pick is "distinct enough".
  const sourceAccent = sourceAccentMatch?.[1] ?? "#000000";
  const newAccent = pickDistinctAccent(sourceAccent, seed);

  const rewritten = shiftThemeAccent(content, newAccent);
  if (!rewritten) {
    return { applied: false, reason: "layout.tsx has no createTheme() call — older/non-standard scaffold, theme left unchanged" };
  }

  writeFn(layoutPath, rewritten);
  return { applied: true, newAccent };
}
