// 2026-08-16 (aanya-nexui-migration Task 2): rewritten for @yugnex/core's
// real theming API. Everything below was verified this session against the
// ACTUAL source (E:\nex-ui\packages\core\src\theme\{createTheme,tokens}.ts)
// and the published dist/index.d.ts — not the README, not assumed from the
// old code's shape. Full trail:
//
// OLD: <NexuiProvider theme="void" customTokens={Record<string,string>}> —
//   customTokens was an OPEN bag of raw CSS custom-property NAMES
//   (--nx-bg-base, --nx-accent, --nx-ff-sans, --nx-font-sans, ...), matched
//   1:1 against whatever NexUI's "void" preset and shadow-DOM primitives
//   happened to read.
// NEW: <ThemeProvider theme={createTheme(overrides)}> — createTheme's real
//   signature (packages/core/src/theme/createTheme.ts) takes
//   `ThemeOverrides = { light?: Partial<Record<SemanticColorKey, string>>,
//   dark?: Partial<Record<SemanticColorKey, string>> }`, a FIXED, closed set
//   of ~24 semantic slots (background, foreground, card, primary, border,
//   ring, ...) confirmed against semanticColorsLight/semanticColorsDark in
//   packages/core/src/theme/tokens.ts — not an open bag of arbitrary
//   variable names.
//
// Real, confirmed gap (not a workaround): ThemeOverrides has NO typography
// slot. `fontFamily.sans`/`fontFamily.mono` are fixed baseTokens, entirely
// outside createTheme()'s overridable surface, and every vendored component
// (confirmed directly against apps/docs/public/r/button.json's real source)
// reads `theme.fontFamily.sans` — i.e. `var(--nx-font-family-sans)` —
// directly for its own internal styling. The old per-project font
// customization (design brief's typography.body/display) therefore has NO
// equivalent path through createTheme()/ThemeProvider. This is a genuine,
// deliberate scope reduction from the old system, surfaced here rather than
// guessed around — see buildFontOverrideCss below for what this file does
// instead (and what it deliberately does NOT attempt to cover).
//
// Cascade-order safety (the 2026-08-06 bug class this migration must not
// reintroduce, per the plan's own constraint): verified empirically this
// session — real `npm install` + `next build` + `next start` against a real
// @yugnex/core@0.1.0 install, with createTheme() overrides passed to
// ThemeProvider, then a raw HTML fetch of the rendered page. The override
// colors landed in the SAME SSR-flushed `<style data-nx-ssr>` tag as the
// base theme (ThemeProvider calls insertRawCss() synchronously during
// render — SSR included — and StyleRegistry flushes the full accumulated
// sheet via useServerInsertedHTML); there is no second, later-injected style
// source for a static import to lose a specificity/order fight against, the
// way NexuiProvider's runtime effect-based injection had. Colors are
// therefore routed entirely through createTheme()/ThemeProvider, never
// through a competing static CSS override — see buildFontOverrideCss's own
// comment for why the font gap doesn't reopen that risk either.
import type { DesignBrief } from "../../../vanya/src/index.ts";

function relativeLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG-style black/white contrast pick for text placed on top of an
// arbitrary brand color (used for `primaryForeground`) — simple and
// deterministic rather than reusing the brief's own bg/text colors, which
// aren't guaranteed to contrast well against an unrelated accent hue.
function contrastColor(hex: string): string {
  return relativeLuminance(hex) > 0.5 ? "#0a0a0a" : "#ffffff";
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

interface DerivedPalette {
  bg: string;
  text: string;
  accent: string;
  border: string;
  isLight: boolean;
}

// 2026-08-16: extracted so buildThemeOverrideTokens (colors) and
// themeColorMode (which mode the scaffold pins <ThemeProvider
// defaultColorMode> to) can never disagree about which colors/mode a given
// brief actually resolved to.
//
// 2026-08-16 (real bug found live via this task's own end-to-end build
// check — FALLBACK_BRIEF, agents/vanya/src/index.ts): an earlier version of
// this function computed `isLight` from a mood-text keyword regex BEFORE
// resolving `bg`, then used that same `isLight` as the mode pin. That's
// wrong whenever a keyword match wins bg independently of the mood
// (FALLBACK_BRIEF's mood is "Confident and precise..." — no light/warm/
// bright/paper/airy keyword — so isLight=false — but its palette names a
// "paper" entry, #F6F5F1, luminance 0.96, which findByKeywords picks for bg
// regardless of the mood check). Result: a genuinely light background
// (#F6F5F1) got pinned to defaultColorMode="dark". `light`/`dark` overrides
// carry identical OVERRIDDEN values (see buildThemeOverrideTokens), so the
// override slots themselves rendered fine either way — but every
// UN-overridden semantic slot (destructive/success/warning/overlay/accent)
// falls through to the theme preset's own light-vs-dark default, and those
// genuinely differ (dark-preset danger/success/warning shades are tuned for
// readability against a dark background) — pinning "dark" against an
// actually-light bg would have shipped visibly wrong contrast on any
// unoverridden semantic color the moment a component used one. Fixed by
// deriving isLight from the ACTUAL resolved bg color's own luminance, not a
// separate mood heuristic — the mood regex is now only a tie-breaker for
// picking bg/text when no keyword match exists at all.
function derivePalette(brief: DesignBrief): DerivedPalette {
  const palette = brief.palette;
  const sorted = [...palette].sort((a, b) => relativeLuminance(a.hex) - relativeLuminance(b.hex));
  const darkest = sorted[0]?.hex ?? "#0D1117";
  const lightest = sorted[sorted.length - 1]?.hex ?? "#E6EDF3";

  // Mood decides dark-vs-light base ONLY when no named bg/text color is
  // found — default to dark (matches the old system's "void" baseline)
  // unless the mood text clearly signals a light theme.
  const moodIsLight = /\blight\b|\bbright\b|\bwarm\b|\bpaper\b|\bairy\b/i.test(brief.mood);

  const bg = findByKeywords(palette, ["background", "bg", "paper", "surface"]) ?? (moodIsLight ? lightest : darkest);
  const text = findByKeywords(palette, ["ink", "text", "foreground", "fg"]) ?? (moodIsLight ? darkest : lightest);
  const accentCandidate = findByKeywords(palette, ["accent", "primary", "brand"]);
  const accent = accentCandidate ?? sorted[Math.floor(sorted.length / 2)]?.hex ?? "#E89010";
  const border = findByKeywords(palette, ["border", "muted", "outline"]) ?? sorted[1]?.hex ?? sorted[0]?.hex ?? "#30363D";

  // The mode pin MUST agree with whichever bg color actually won above
  // (keyword match takes priority over the mood text) — derived from bg's
  // own luminance, not re-asking the mood heuristic a second time.
  const isLight = relativeLuminance(bg) > 0.5;

  return { bg, text, accent, border, isLight };
}

/**
 * Which color mode the generated scaffold pins <ThemeProvider
 * defaultColorMode> to for this project. A fixed pin (not "system") mirrors
 * the old system's fixed "void" theme — never a system-preference-driven
 * light/dark switch a design brief was never built to describe two variants
 * for.
 */
export function themeColorMode(brief: DesignBrief): "light" | "dark" {
  return derivePalette(brief).isLight ? "light" : "dark";
}

// Real, confirmed @yugnex/core semantic color slot names (a subset of
// semanticColorsLight/semanticColorsDark in packages/core/src/theme/
// tokens.ts) — duck-typed locally rather than importing @yugnex/core's own
// ThemeOverrides type, because @yugnex/core is a dependency of GENERATED
// projects only; it is never added to NexSidi's own workspace (this file —
// agents/generators/aanya — is NexSidi's own generator code, not generated
// output).
export interface ThemeColorOverrides {
  light?: Record<string, string>;
  dark?: Record<string, string>;
}

/**
 * Derives real, per-project semantic color overrides in the shape
 * @yugnex/core's createTheme(overrides) actually expects — passed by the
 * scaffold as <ThemeProvider theme={createTheme(buildThemeOverrideTokens(...))}>.
 *
 * Only the semantic slots the design brief's 4-value palette (background,
 * text, accent, border) gives real signal for are set — background,
 * foreground, card/popover (reuse background), border/input/muted (reuse
 * border), secondary (reuse border), primary/ring (reuse accent), plus a
 * computed primaryForeground for real contrast. Every other slot
 * (destructive, success, warning, the soft `accent` tint, ...) is
 * deliberately left unset so it falls through to the theme preset's own
 * default — the OLD customTokens mechanism had the exact same scope (it
 * never set --nx-red/--nx-green either), so this is not a regression.
 *
 * `light` and `dark` carry IDENTICAL values: the scaffold pins
 * defaultColorMode to whichever mode themeColorMode(brief) already chose
 * (see its own comment), so only one side is ever actually rendered — but
 * populating both means a future mode-toggle feature can't silently fall
 * back to the base preset's unrelated default colors for the untested side.
 */
export function buildThemeOverrideTokens(brief: DesignBrief): ThemeColorOverrides {
  const { bg, text, accent, border } = derivePalette(brief);
  const primaryForeground = contrastColor(accent);

  const colors: Record<string, string> = {
    background: bg,
    foreground: text,
    card: bg,
    cardForeground: text,
    popover: bg,
    popoverForeground: text,
    border,
    input: border,
    muted: border,
    mutedForeground: text,
    secondary: border,
    secondaryForeground: text,
    primary: accent,
    primaryForeground,
    ring: accent,
  };

  return { light: colors, dark: { ...colors } };
}

// 2026-08-16 (post-review fix): real bug found live by an independent
// adversarial review — `npm install && npx next build && npx next start`
// against a scaffold generated with the real FALLBACK_BRIEF
// (agents/vanya/src/index.ts), then reading the rendered page's actual
// computed `font-family`. FALLBACK_BRIEF.typography.body is literally
// "Charter (fallback: Georgia, serif)" — Vanya's system prompt never asks
// for this annotation shape, but the fallback brief (and, per its own
// header comment, any brief) can carry it — and the old code embedded that
// whole human-readable string verbatim as a single CSS font name:
// `font-family: 'Charter (fallback: Georgia, serif)', ...`. No browser
// matches a font literally named that, so it silently fell through to the
// generic tail — the per-project typeface was never actually applied for
// this brief.
//
// The annotation is genuine, useful data, not noise: "Charter (fallback:
// Georgia, serif)" means "prefer Charter; if unavailable, Georgia, then
// serif" — exactly what a CSS font-family fallback chain is for. Rather
// than just stripping it, parseFontSpec below extracts BOTH the real
// primary name AND the author's own fallback chain, and splices that chain
// into the generated CSS ahead of the generic system-font tail — so the
// annotation's real information survives into the output instead of being
// discarded.
const CSS_GENERIC_FONT_KEYWORDS = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji", "fangsong",
]);

interface ParsedFontSpec {
  name: string;
  fallbacks: string[];
}

// Splits a typeface string like "Charter (fallback: Georgia, serif)" into
// its real primary name ("Charter") and an explicit fallback chain
// (["Georgia", "serif"]). A name with no such annotation just yields an
// empty fallback list. Exported for direct unit testing.
export function parseFontSpec(raw: string): ParsedFontSpec {
  const match = raw.match(/^(.*?)\s*\(fallback:\s*(.+?)\)\s*$/i);
  if (!match) return { name: raw.trim(), fallbacks: [] };
  const name = (match[1] ?? "").trim();
  const fallbacks = (match[2] ?? "").split(",").map((f) => f.trim()).filter(Boolean);
  return { name: name || raw.trim(), fallbacks };
}

// Renders one font-family token: generic CSS keywords (serif, system-ui,
// ...) must stay bare or they stop being recognized as generic families;
// every real typeface name is quoted since it may contain spaces (and
// quoting a single-word name like Charter is always valid CSS too).
function cssFontToken(name: string): string {
  return CSS_GENERIC_FONT_KEYWORDS.has(name.toLowerCase()) ? name : `'${name}'`;
}

// Builds a full font-family declaration value: the brief's real typeface
// name, then its own explicit fallback chain (if the "(fallback: ...)"
// annotation supplied one), then the fixed generic system-font tail — unless
// the brief's own chain already ends in a generic CSS keyword, in which case
// appending more after it would be dead/unreachable and is skipped.
//
// `genericTail` entries are pre-formatted literal CSS tokens (already
// correctly quoted/unquoted, e.g. `-apple-system`, `'Segoe UI'`) and are
// appended as-is — only `raw`'s own name/fallback tokens are run through
// cssFontToken, since re-quoting an already-quoted or already-bare tail
// token would produce broken CSS (e.g. `''Segoe UI''` or `'-apple-system'`).
function buildFontFamilyValue(raw: string, genericTail: string[]): string {
  const { name, fallbacks } = parseFontSpec(raw);
  const customTokens = [name, ...fallbacks].map(cssFontToken);
  const lastFallback = fallbacks[fallbacks.length - 1]?.toLowerCase();
  const chainEndsGeneric = lastFallback !== undefined && CSS_GENERIC_FONT_KEYWORDS.has(lastFallback);
  const allTokens = chainEndsGeneric ? customTokens : [...customTokens, ...genericTail];
  return allTokens.join(", ");
}

/**
 * Covers the one real gap createTheme() leaves open: per-project typography.
 * Deliberately does NOT touch any `--nx-*` CSS custom property (that's the
 * exact mechanism the 2026-08-06 cascade bug came from — two writers
 * targeting the same variable) — it sets the literal `font-family` property
 * on plain page-authored elements (html/body/headings) directly. This is a
 * genuine, narrower scope than the old system: it covers page-authored text
 * (the majority of a generated app's visible copy), but deliberately leaves
 * vendored NexUI component internals (Button/Badge/Tab labels, which read
 * `theme.fontFamily.sans` — i.e. `var(--nx-font-family-sans)` — directly) on
 * the library's own default UI typeface, since there is no supported way to
 * override that variable without re-fighting the same cascade risk this
 * migration must not reintroduce.
 */
export function buildFontOverrideCss(brief: DesignBrief): string {
  const bodyFont = buildFontFamilyValue(brief.typography.body, [
    "-apple-system", "BlinkMacSystemFont", "'Segoe UI'", "sans-serif",
  ]);
  const displayFont = buildFontFamilyValue(brief.typography.display, [
    "-apple-system", "BlinkMacSystemFont", "sans-serif",
  ]);
  return `html, body {
  font-family: ${bodyFont};
}

h1, h2, h3, h4, h5, h6 {
  font-family: ${displayFont};
}
`;
}
