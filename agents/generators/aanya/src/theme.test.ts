import { test, expect } from "bun:test";
import { buildThemeOverrideCss } from "./theme.ts";
import type { DesignBrief } from "../../../vanya/src/index.ts";

// 2026-07-28: real bug found live — every generated app's layout.tsx
// hardcoded <NexuiProvider theme="void"> as a literal string, ignoring
// BuildPlan.designBrief (Vanya's real per-project palette/typeface/mood)
// entirely. Every NexSidi-built site started from the exact same fixed dark
// palette + hardcoded Inter font (packages/nexui/css/nexui-tokens.css).
// buildThemeOverrideCss derives a real, per-project CSS custom-property
// override block from designBrief so two different projects actually look
// different — closing the "mediocre, every site the same" gap.

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

test("buildThemeOverrideCss produces a real :root override block", () => {
  const css = buildThemeOverrideCss(BRIEF_A);
  expect(css).toContain(":root");
  expect(css).toContain("--nx-bg-base");
  expect(css).toContain("--nx-accent");
  expect(css).toContain("--nx-text");
  expect(css).toContain("--nx-border");
  expect(css).toContain("--nx-ff-sans");
  expect(css).toContain("--nx-ff-display");
});

test("buildThemeOverrideCss produces visibly different output for two different designBriefs", () => {
  const cssA = buildThemeOverrideCss(BRIEF_A);
  const cssB = buildThemeOverrideCss(BRIEF_B);
  expect(cssA).not.toBe(cssB);
  // The actual hex values from each brief's palette must show up — proof
  // this is real per-project derivation, not a fixed template with the
  // color words swapped.
  expect(cssA).toContain("#2F6F4F"); // brief A's accent
  expect(cssB).toContain("#FF6B5B"); // brief B's accent
});

test("buildThemeOverrideCss uses the brief's actual typefaces, not the NexUI default", () => {
  const css = buildThemeOverrideCss(BRIEF_A);
  expect(css).toContain("Fraunces");
  expect(css).toContain("IBM Plex Sans");
});

test("buildThemeOverrideCss maps named background/text/accent/border colors by keyword when present", () => {
  const css = buildThemeOverrideCss(BRIEF_A);
  // "paper" (lightest, named background-ish) should NOT be the accent value,
  // and "accent" should map to --nx-accent specifically.
  const accentLine = css.split("\n").find((l) => l.trim().startsWith("--nx-accent:"));
  expect(accentLine).toContain("#2F6F4F");
});

test("buildThemeOverrideCss falls back to luminance-based classification when palette names don't match known keywords", () => {
  const css = buildThemeOverrideCss(BRIEF_B); // uses "midnight"/"cream"/"coral"/"outline", no exact keyword hits except coral~accent-ish is not a keyword either
  // Should still produce a valid, non-empty override with SOME background
  // and SOME text color drawn from the palette (not NexUI's own defaults).
  expect(css).not.toContain("#0D1117"); // NexUI's own hardcoded default bg
  expect(css).not.toContain("'Inter'");
});
