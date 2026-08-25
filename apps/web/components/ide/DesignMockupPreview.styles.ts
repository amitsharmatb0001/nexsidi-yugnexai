"use client";

// Chrome around DesignMockupPreview.tsx's rendered mockup — the frame/label
// use the theme system for consistency with the rest of the approval gate;
// the mockup's own surfaces are styled inline with the real palette hex
// values at render time, which a static css() call can't express.

import { css, themeVars as theme } from "@yugnex/core";

export const mockup = {
  frame: css({ marginTop: theme.space[4] }),
  frameLabel: css({
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginBottom: theme.space[2.5],
    fontSize: "11px",
    color: theme.color.mutedForeground,
  }),
  frameLabelDot: css({
    width: "5px",
    height: "5px",
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.primary,
    flexShrink: 0,
  }),
  canvas: css({
    border: "1px solid",
    borderRadius: theme.radius.md,
    padding: theme.space[5],
    overflow: "hidden",
  }),
  nav: css({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: theme.space[3],
    marginBottom: theme.space[6],
    borderBottom: "1px solid",
    fontSize: "12px",
  }),
  navBrand: css({ display: "flex", alignItems: "center", gap: "8px", fontWeight: theme.fontWeight.semibold }),
  navDot: css({ width: "10px", height: "10px", borderRadius: theme.radius.full, flexShrink: 0 }),
  navLinks: css({ display: "flex", gap: theme.space[4], opacity: 0.7 }),
  navCta: css({
    padding: "5px 12px",
    borderRadius: theme.radius.sm,
    color: "#fff",
    fontSize: "11px",
    fontWeight: theme.fontWeight.medium,
  }),
  hero: css({
    maxWidth: "460px",
    marginBottom: theme.space[6],
  }),
  heroHeading: css({
    fontSize: "28px",
    fontWeight: theme.fontWeight.semibold,
    lineHeight: 1.15,
    letterSpacing: "-0.01em",
    marginBottom: theme.space[3],
  }),
  heroBody: css({
    fontSize: "13.5px",
    lineHeight: 1.65,
    opacity: 0.75,
    marginBottom: theme.space[4],
  }),
  heroCta: css({
    display: "inline-block",
    padding: "9px 18px",
    borderRadius: theme.radius.sm,
    color: "#fff",
    fontSize: "12.5px",
    fontWeight: theme.fontWeight.medium,
  }),
  cardRow: css({ display: "flex", gap: theme.space[3] }),
  card: css({
    flex: 1,
    border: "1px solid",
    borderRadius: theme.radius.sm,
    padding: theme.space[3],
  }),
  cardTitle: css({ fontSize: "12.5px", fontWeight: theme.fontWeight.medium, marginBottom: "4px" }),
  cardBody: css({ fontSize: "11.5px", opacity: 0.7, lineHeight: 1.5 }),
};
