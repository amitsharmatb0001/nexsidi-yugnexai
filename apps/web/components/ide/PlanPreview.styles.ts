"use client";

// Renders the real build spec (BuildPlan) inside the IDE's approval gate.
// This data already existed (fetched via build-plan.json into buildPlanModal
// in app/build/[id]/page.tsx) but was only ever used as a boolean flag — the
// approval gate showed a generic "Specification ready" card and discarded
// the actual plan content. Same token system as IDE.styles.ts.

import { css, themeVars as theme } from "@yugnex/core";

const ease = theme.easing.standard;
const inkQuiet = `color-mix(in srgb, ${theme.color.mutedForeground} 62%, transparent)`;

const METHOD_COLOR: Record<string, string> = {
  GET: theme.color.success,
  POST: theme.color.primary,
  PUT: theme.color.primary,
  PATCH: theme.color.warning,
  DELETE: theme.color.destructive,
};

export function methodColor(method: string): string {
  return METHOD_COLOR[method.toUpperCase()] ?? theme.color.mutedForeground;
}

export const plan = {
  root: css({ height: "100%", overflowY: "auto", padding: "28px 32px 60px" }),
  appName: css({ fontSize: theme.fontSize.xl, fontWeight: theme.fontWeight.semibold, color: theme.color.foreground, letterSpacing: "-0.01em" }),
  appDesc: css({ marginTop: theme.space[1.5], fontSize: theme.fontSize.sm, color: theme.color.mutedForeground, lineHeight: 1.6, maxWidth: "640px" }),

  section: css({ marginTop: theme.space[6] }),
  sectionTitle: css({
    fontSize: "11px",
    fontWeight: theme.fontWeight.semibold,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    color: inkQuiet,
    marginBottom: theme.space[2.5],
  }),

  mood: css({ fontSize: theme.fontSize.sm, color: theme.color.mutedForeground, lineHeight: 1.6, maxWidth: "600px", marginBottom: theme.space[3] }),
  palette: css({ display: "flex", flexWrap: "wrap", gap: theme.space[3] }),
  swatch: css({ display: "flex", alignItems: "center", gap: theme.space[1.5] }),
  swatchDot: css({
    width: "16px",
    height: "16px",
    borderRadius: theme.radius.full,
    border: `1px solid ${theme.color.border}`,
    flex: "none",
  }),
  swatchLabel: css({ fontSize: "12px", color: theme.color.mutedForeground, fontFamily: "var(--nx-ff-mono)" }),
  typography: css({
    display: "flex",
    gap: theme.space[4],
    marginTop: theme.space[3],
    fontSize: "12px",
    color: inkQuiet,
  }),

  feature: css({ marginBottom: theme.space[4] }),
  featureName: css({ fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.medium, color: theme.color.foreground }),
  featureDesc: css({ marginTop: "3px", fontSize: theme.fontSize.sm, color: theme.color.mutedForeground, lineHeight: 1.6 }),
  storyList: css({ marginTop: theme.space[2], paddingLeft: theme.space[4], display: "flex", flexDirection: "column", gap: "4px" }),
  story: css({ fontSize: "12.5px", color: inkQuiet, lineHeight: 1.6 }),

  endpointRow: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[2.5],
    marginBottom: theme.space[1.5],
    fontFamily: "var(--nx-ff-mono)",
    fontSize: "12px",
  }),
  methodBadge: css({
    flex: "none",
    width: "50px",
    fontWeight: theme.fontWeight.semibold,
    fontSize: "10.5px",
  }),
  endpointRoute: css({ color: theme.color.mutedForeground }),

  table: css({ marginBottom: theme.space[3] }),
  tableName: css({ fontFamily: "var(--nx-ff-mono)", fontSize: theme.fontSize.sm, color: theme.color.foreground, fontWeight: theme.fontWeight.medium }),
  fieldList: css({ display: "flex", flexWrap: "wrap", gap: theme.space[1.5], marginTop: theme.space[1.5] }),
  field: css({
    fontFamily: "var(--nx-ff-mono)",
    fontSize: "11px",
    color: inkQuiet,
    background: theme.color.muted,
    padding: "2px 7px",
    borderRadius: theme.radius.sm,
  }),

  task: css({
    fontSize: theme.fontSize.sm,
    color: theme.color.mutedForeground,
    marginBottom: theme.space[2],
    paddingLeft: theme.space[3],
    borderLeft: `2px solid ${theme.color.border}`,
    lineHeight: 1.6,
  }),
};
