import { test, expect } from "bun:test";
import { buildFontOverrideCss, buildThemeOverrideTokens, parseFontSpec, themeColorMode } from "./theme.ts";
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

// ── buildFontOverrideCss (typography-only; colors moved to createTheme()) ──

test("buildFontOverrideCss sets html/body and heading font-family from the brief's real typefaces", () => {
  const css = buildFontOverrideCss(BRIEF_A);
  expect(css).toContain("Fraunces");
  expect(css).toContain("IBM Plex Sans");
  expect(css).toMatch(/html,\s*body\s*\{[^}]*font-family/);
});

test("buildFontOverrideCss does NOT touch any --nx-* CSS custom property (avoids re-fighting NexUI's own theme cascade)", () => {
  // The old cascade-order bug (2026-08-06, index.ts's own header comment)
  // came from two different writers targeting the SAME --nx-font-sans
  // variable. This file no longer writes to any --nx-* variable at all —
  // it sets the literal `font-family` property directly, a target NexUI's
  // own runtime theme CSS never declares, so there is nothing to race.
  const css = buildFontOverrideCss(BRIEF_A);
  expect(css).not.toContain("--nx-");
  expect(css).not.toContain(":root");
});

test("buildFontOverrideCss produces visibly different output for two different designBriefs", () => {
  const cssA = buildFontOverrideCss(BRIEF_A);
  const cssB = buildFontOverrideCss(BRIEF_B);
  expect(cssA).not.toBe(cssB);
  expect(cssA).toContain("IBM Plex Sans");
  expect(cssB).toContain("Source Serif 4");
});

// ── real bug: "(fallback: ...)" annotation embedded verbatim ───────────────
// Found live by an independent adversarial review — a real `npm install &&
// npx next build && npx next start` against a scaffold generated with the
// REAL FALLBACK_BRIEF (agents/vanya/src/index.ts), then reading the actual
// rendered page's computed `font-family`, showed the literal string
// "Charter (fallback: Georgia, serif)" landing whole inside a single CSS
// font name — a font no browser will ever match, silently collapsing to the
// generic tail. BRIEF_A/BRIEF_B above use clean synthetic names
// ("Fraunces", "IBM Plex Sans") that never exercise this path — that's
// exactly why the bug shipped uncaught the first time. This test uses
// FALLBACK_BRIEF itself, unmodified, so it can't drift from the real data.

test("buildFontOverrideCss extracts a clean font name from FALLBACK_BRIEF's real '(fallback: ...)' typography — does not embed the annotation verbatim", () => {
  // Real values, not a synthetic stand-in: FALLBACK_BRIEF.typography is
  // { display: "Söhne (fallback: system-ui)", body: "Charter (fallback: Georgia, serif)" }.
  const css = buildFontOverrideCss(FALLBACK_BRIEF);

  // The literal parenthetical annotation must never reach the generated CSS.
  expect(css).not.toContain("(fallback:");
  expect(css).not.toContain(")");

  // The real typeface names must still be present, as clean CSS tokens.
  expect(css).toContain("'Charter'");
  expect(css).toContain("'Söhne'");

  // The body rule's font-family value must be valid, comma-separated CSS —
  // sanity-check by extracting it and confirming it parses into tokens with
  // no stray unbalanced quote or paren.
  const bodyMatch = css.match(/html,\s*body\s*\{\s*font-family:\s*([^;]+);/);
  expect(bodyMatch).not.toBeNull();
  const bodyValue = bodyMatch?.[1] ?? "";
  expect(bodyValue).not.toContain("(");
  // Even quote count (each quoted token opens+closes) confirms nothing was
  // left mid-token by the parenthetical stripping.
  expect((bodyValue.match(/'/g) ?? []).length % 2).toBe(0);
});

test("buildFontOverrideCss uses the annotation's own fallback chain as real CSS fallback fonts, not just discarding it", () => {
  // "Charter (fallback: Georgia, serif)" is read as "prefer Charter, then
  // Georgia, then the generic serif family" — that's real fallback-chain
  // information, not just a human-readable note, so it should survive into
  // the generated font-family stack in order.
  const css = buildFontOverrideCss(FALLBACK_BRIEF);
  const bodyMatch = css.match(/html,\s*body\s*\{\s*font-family:\s*([^;]+);/);
  const bodyValue = bodyMatch?.[1] ?? "";
  const charterIndex = bodyValue.indexOf("Charter");
  const georgiaIndex = bodyValue.indexOf("Georgia");
  const serifIndex = bodyValue.indexOf("serif");
  expect(charterIndex).toBeGreaterThanOrEqual(0);
  expect(georgiaIndex).toBeGreaterThan(charterIndex);
  expect(serifIndex).toBeGreaterThan(georgiaIndex);
});

test("parseFontSpec splits a '(fallback: ...)' annotation into a clean name and an explicit fallback chain", () => {
  expect(parseFontSpec("Charter (fallback: Georgia, serif)")).toEqual({
    name: "Charter",
    fallbacks: ["Georgia", "serif"],
  });
  expect(parseFontSpec("Söhne (fallback: system-ui)")).toEqual({
    name: "Söhne",
    fallbacks: ["system-ui"],
  });
});

test("parseFontSpec returns the name unchanged with no fallbacks when there is no annotation", () => {
  expect(parseFontSpec("Fraunces")).toEqual({ name: "Fraunces", fallbacks: [] });
  expect(parseFontSpec("IBM Plex Sans")).toEqual({ name: "IBM Plex Sans", fallbacks: [] });
});
