import { test, expect } from "bun:test";
import { buildFontOverrideCss, buildThemeOverrideTokens, themeColorMode, usedInHouseFonts } from "./theme.ts";
import type { DesignBrief } from "../../../vanya/src/index.ts";
import { FALLBACK_BRIEF } from "../../../vanya/src/index.ts";

// 2026-08-16 (aanya-nexui-migration Task 2): rewritten for @yugnex/core's
// real theming API (packages/core/src/theme/createTheme.ts in the nex-ui
// repo, verified against source + published dist/index.d.ts this session —
// see index.ts's header comment on theme.ts's import for the full audit).
// The old NexuiProvider `customTokens` mechanism accepted an arbitrary
// Record<string, string> of raw CSS custom-property NAMES
// (--nx-bg-base, --nx-ff-sans, ...). The new createTheme(overrides) takes a
// FIXED, closed set of semantic color slots under `{ light?, dark? }` — no
// arbitrary variable names, and (confirmed against createTheme's real
// ThemeOverrides type + semanticColorsLight/Dark in tokens.ts) NO typography
// slot at all. buildThemeOverrideTokens now returns that closed shape;
// buildFontOverrideCss covers the typography gap createTheme() doesn't (see
// its own header comment in theme.ts).

const BRIEF_A: DesignBrief = {
  mood: "Confident and precise — a technical product that trusts its own substance.",
  palette: [
    { name: "ink", hex: "#14171F" },
    { name: "paper", hex: "#F6F5F1" },
    { name: "accent", hex: "#2F6F4F" },
    { name: "accent-muted", hex: "#8FB5A0" },
    { name: "border", hex: "#D8D5CC" },
  ],
  typography: { display: "Fraunces", body: "IBM Plex Sans" },
  layoutConcept: "Dense, grid-aligned sections.",
};

const BRIEF_B: DesignBrief = {
  mood: "Playful and warm — approachable, human, unafraid of color.",
  palette: [
    { name: "midnight", hex: "#1B1035" },
    { name: "cream", hex: "#FDF6EC" },
    { name: "coral", hex: "#FF6B5B" },
    { name: "coral-muted", hex: "#FFC4BC" },
    { name: "outline", hex: "#3A2E5C" },
  ],
  typography: { display: "Space Grotesk", body: "Source Serif 4" },
  layoutConcept: "Loose, asymmetric cards with generous whitespace.",
};

// ── buildThemeOverrideTokens (new @yugnex/core ThemeOverrides shape) ───────

test("buildThemeOverrideTokens returns a { light, dark } object, not a flat --nx-* var record", () => {
  const tokens = buildThemeOverrideTokens(BRIEF_A);
  expect(tokens).toHaveProperty("light");
  expect(tokens).toHaveProperty("dark");
  expect(typeof tokens.light).toBe("object");
  expect(typeof tokens.dark).toBe("object");
});

test("buildThemeOverrideTokens uses real @yugnex/core semantic color keys, not raw CSS variable names", () => {
  const tokens = buildThemeOverrideTokens(BRIEF_A);
  // Real slot names confirmed against packages/core/src/theme/tokens.ts's
  // semanticColorsLight/semanticColorsDark — no "--nx-" prefix, since these
  // are plain object keys consumed by createTheme(), not CSS var names.
  for (const key of Object.keys(tokens.light!)) {
    expect(key.startsWith("--nx-")).toBe(false);
  }
  expect(tokens.light).toHaveProperty("background");
  expect(tokens.light).toHaveProperty("foreground");
  expect(tokens.light).toHaveProperty("primary");
  expect(tokens.light).toHaveProperty("border");
});

test("buildThemeOverrideTokens maps the brief's named accent color to 'primary', not an unrelated slot", () => {
  const tokens = buildThemeOverrideTokens(BRIEF_A);
  expect(tokens.light!.primary).toBe("#2F6F4F");
  expect(tokens.dark!.primary).toBe("#2F6F4F");
});

test("buildThemeOverrideTokens maps named background/text/border colors by keyword when present", () => {
  const tokens = buildThemeOverrideTokens(BRIEF_A);
  expect(tokens.light!.background).toBe("#F6F5F1"); // "paper"
  expect(tokens.light!.foreground).toBe("#14171F"); // "ink"
  expect(tokens.light!.border).toBe("#D8D5CC"); // "border"
});

test("buildThemeOverrideTokens falls back to luminance-based classification when palette names don't match known keywords", () => {
  const tokens = buildThemeOverrideTokens(BRIEF_B); // "midnight"/"cream"/"coral"/"outline" — no exact keyword hits
  expect(tokens.light!.background).not.toBe("#0D1117"); // not NexUI's own hardcoded default
  expect(Object.values(tokens.light!)).toContain("#FF6B5B"); // brief B's coral, used as primary
});

test("buildThemeOverrideTokens computes primaryForeground for real contrast against the brand color, not a fixed value", () => {
  const tokensA = buildThemeOverrideTokens(BRIEF_A); // dark accent (#2F6F4F) -> needs light text
  const tokensB = buildThemeOverrideTokens(BRIEF_B); // bright coral (#FF6B5B) -> needs dark text
  expect(tokensA.light!.primaryForeground).toBe("#ffffff");
  expect(tokensB.light!.primaryForeground).toBe("#0a0a0a");
});

test("buildThemeOverrideTokens produces visibly different output for two different designBriefs", () => {
  const tokensA = buildThemeOverrideTokens(BRIEF_A);
  const tokensB = buildThemeOverrideTokens(BRIEF_B);
  expect(tokensA.light!.primary).not.toBe(tokensB.light!.primary);
  expect(tokensA.light!.background).not.toBe(tokensB.light!.background);
});

test("buildThemeOverrideTokens gives identical light/dark override values (single pinned identity, matching the old fixed-theme behavior)", () => {
  // The generated scaffold pins <ThemeProvider defaultColorMode> to whichever
  // mode themeColorMode(brief) picks — mirroring the OLD system's fixed
  // "void" theme (never a system-driven light/dark switch). Both slots carry
  // the same values so a future mode-toggle feature can't silently fall back
  // to the base preset's unrelated default colors for the untested mode.
  const tokens = buildThemeOverrideTokens(BRIEF_A);
  expect(tokens.dark).toEqual(tokens.light);
});

test("buildThemeOverrideTokens does NOT set a typography/font slot — createTheme() has no such field", () => {
  // Real, confirmed gap (not an oversight): @yugnex/core's ThemeOverrides
  // type only covers semantic colors. Asserting this negative locks in that
  // the function doesn't silently reintroduce a bogus "font" key that
  // createTheme() would just ignore.
  const tokens = buildThemeOverrideTokens(BRIEF_A);
  expect(tokens.light).not.toHaveProperty("fontFamily");
  expect(tokens.light).not.toHaveProperty("font");
});

// ── themeColorMode ───────────────────────────────────────────────────────
// 2026-08-16 (real bug found live via this task's own end-to-end build
// check): mode MUST be derived from the ACTUAL resolved background color's
// luminance, not a separate mood-text heuristic computed independently —
// see theme.ts's derivePalette comment for the full incident
// (FALLBACK_BRIEF's mood has no light/warm/bright keyword, but its "paper"
// keyword-matched background is objectively light — an earlier version of
// this function pinned "dark" against that light background, which would
// have shipped every un-overridden semantic color, e.g. destructive/
// success/warning, from the wrong-contrast preset).

test("themeColorMode agrees with the ACTUAL resolved background's luminance, not the mood text alone", () => {
  // BRIEF_A's mood has no light/warm/bright/paper/airy keyword, but its
  // palette names an entry "paper" (#F6F5F1, objectively light) that
  // findByKeywords resolves to background regardless of the mood text —
  // mode must follow that real color, not the mood.
  expect(themeColorMode(BRIEF_A)).toBe("light");
});

test("themeColorMode picks 'light' for a brief whose mood signals warmth/brightness and has no keyword-matched background", () => {
  expect(themeColorMode(BRIEF_B)).toBe("light"); // "cream" wins via luminance fallback, itself light
});

test("themeColorMode picks 'dark' when the resolved background is genuinely dark", () => {
  const darkBrief: DesignBrief = {
    mood: "Moody and dramatic — deep shadow, high contrast.",
    palette: [
      { name: "background", hex: "#0A0A0F" },
      { name: "text", hex: "#F5F5F7" },
      { name: "accent", hex: "#7C5CFF" },
      { name: "border", hex: "#2A2A33" },
    ],
    typography: { display: "Inter", body: "Inter" },
    layoutConcept: "Full-bleed dark sections.",
  };
  expect(themeColorMode(darkBrief)).toBe("dark");
});

// ── buildFontOverrideCss: in-house fonts only (approved 2 Oct 2026) ──────

test("buildFontOverrideCss maps the brief's typefaces to in-house fonts and exposes them as CSS variables", () => {
  const css = buildFontOverrideCss(BRIEF_A); // Fraunces / IBM Plex Sans — not in-house
  expect(css).toContain("--font-display: 'NexuiSans'");
  expect(css).toContain("--font-body: 'Inter'");
  expect(css).toContain("--font-mono: 'JetBrains Mono'");
  expect(css).toMatch(/html,\s*body\s*\{[^}]*font-family: var\(--font-body\)/);
  expect(css).toMatch(/h1, h2, h3, h4, h5, h6 \{[^}]*font-family: var\(--font-display\)/);
  expect(css).not.toContain("Fraunces");
});

test("buildFontOverrideCss never touches NexUI's own --nx-* variables", () => {
  expect(buildFontOverrideCss(BRIEF_A)).not.toContain("--nx-");
});

test("FALLBACK_BRIEF produces clean in-house font CSS (no '(fallback: ...)' text)", () => {
  const css = buildFontOverrideCss(FALLBACK_BRIEF);
  expect(css).not.toContain("(fallback:");
  expect(css).toContain("'NexuiSans'");
});

test("usedInHouseFonts lists the display, body and mono families once each", () => {
  expect(usedInHouseFonts(BRIEF_A)).toEqual(["NexuiSans", "Inter", "JetBrains Mono"]);
});
