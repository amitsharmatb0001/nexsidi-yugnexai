"use client";

// Renders the real build spec (BuildPlan) inside the IDE's approval gate, as
// an actual document — numbered sections, real tables for the API contract
// and DB schema — not a compact card. The complaint this answers, verbatim:
// approving a spec showed "8-10 lines", not what was actually about to be
// built. Same token system as IDE.styles.ts.

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
  root: css({ height: "100%", overflowY: "auto", padding: "32px 40px 80px" }),

  header: css({ paddingBottom: theme.space[6], borderBottom: `1px solid ${theme.color.border}`, marginBottom: theme.space[6] }),
  appName: css({ fontSize: theme.fontSize["2xl"], fontWeight: theme.fontWeight.semibold, color: theme.color.foreground, letterSpacing: "-0.015em" }),
  appDesc: css({ marginTop: theme.space[2.5], fontSize: theme.fontSize.sm, color: theme.color.mutedForeground, lineHeight: 1.7, maxWidth: "720px" }),

  section: css({ marginTop: theme.space[8] }),
  sectionHead: css({ display: "flex", alignItems: "baseline", gap: theme.space[2], marginBottom: "14px" }),
  sectionNum: css({
    fontFamily: "var(--nx-ff-mono)",
    fontSize: "12px",
    color: theme.color.primary,
    fontWeight: theme.fontWeight.semibold,
  }),
  sectionTitle: css({ fontSize: theme.fontSize.base, fontWeight: theme.fontWeight.semibold, color: theme.color.foreground }),

  prose: css({ fontSize: theme.fontSize.sm, color: theme.color.mutedForeground, lineHeight: 1.75, maxWidth: "720px" }),

  // ── Design direction ───────────────────────────────────────────────────
  palette: css({ display: "flex", flexWrap: "wrap", gap: theme.space[4], marginTop: theme.space[4] }),
  swatch: css({ display: "flex", alignItems: "center", gap: theme.space[2] }),
  swatchDot: css({
    width: "22px",
    height: "22px",
    borderRadius: theme.radius.sm,
    border: `1px solid ${theme.color.border}`,
    flex: "none",
  }),
  swatchText: css({ display: "flex", flexDirection: "column" }),
  swatchName: css({ fontSize: "12px", color: theme.color.foreground }),
  swatchHex: css({ fontSize: "10.5px", fontFamily: "var(--nx-ff-mono)", color: inkQuiet }),
  typography: css({
    display: "flex",
    gap: theme.space[6],
    marginTop: theme.space[4],
    fontSize: theme.fontSize.sm,
  }),
  typographyLabel: css({ color: inkQuiet, marginRight: theme.space[1.5] }),
  typographyValue: css({ color: theme.color.foreground, fontWeight: theme.fontWeight.medium }),

  // ── Features ─────────────────────────────────────────────────────────
  feature: css({
    marginBottom: theme.space[5],
    paddingBottom: theme.space[5],
    borderBottom: `1px solid ${theme.color.border}`,
    "&:last-child": { borderBottom: "none", marginBottom: 0, paddingBottom: 0 },
  }),
  featureName: css({ fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.semibold, color: theme.color.foreground }),
  featureDesc: css({ marginTop: theme.space[1.5], fontSize: theme.fontSize.sm, color: theme.color.mutedForeground, lineHeight: 1.7, maxWidth: "720px" }),
  storyList: css({ marginTop: theme.space[2.5], paddingLeft: theme.space[4], display: "flex", flexDirection: "column", gap: theme.space[1.5] }),
  story: css({ fontSize: "12.5px", color: inkQuiet, lineHeight: 1.65 }),

  // ── Tables (API contract, DB schema) ────────────────────────────────────
  baseUrl: css({
    display: "inline-block",
    fontFamily: "var(--nx-ff-mono)",
    fontSize: "12px",
    color: theme.color.primary,
    background: `color-mix(in srgb, ${theme.color.primary} 10%, transparent)`,
    padding: "3px 9px",
    borderRadius: theme.radius.sm,
    marginBottom: theme.space[4],
  }),
  tableWrap: css({ overflowX: "auto", marginBottom: theme.space[6] }),
  table: css({ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }),
  th: css({
    textAlign: "left",
    padding: "6px 12px 6px 0",
    fontSize: "10.5px",
    fontWeight: theme.fontWeight.semibold,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: inkQuiet,
    borderBottom: `1px solid ${theme.color.border}`,
  }),
  td: css({
    padding: "8px 12px 8px 0",
    borderBottom: `1px solid ${theme.color.border}`,
    color: theme.color.mutedForeground,
    verticalAlign: "top",
  }),
  tableName: css({ fontFamily: "var(--nx-ff-mono)", fontSize: theme.fontSize.sm, color: theme.color.foreground, fontWeight: theme.fontWeight.medium, marginBottom: theme.space[2] }),
  mono: css({ fontFamily: "var(--nx-ff-mono)" }),
  methodBadge: css({ fontWeight: theme.fontWeight.semibold, fontFamily: "var(--nx-ff-mono)", fontSize: "11px" }),
  keyIcon: css({ color: theme.color.warning, marginRight: "4px" }),
  authYes: css({ color: theme.color.mutedForeground }),
  authNo: css({ color: inkQuiet }),

  // ── Tasks ────────────────────────────────────────────────────────────
  taskGroup: css({ marginTop: theme.space[6] }),
  taskGroupTitle: css({
    fontSize: "11px",
    fontWeight: theme.fontWeight.semibold,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    color: inkQuiet,
    marginBottom: theme.space[3],
  }),
  task: css({
    marginBottom: theme.space[3],
    paddingLeft: theme.space[3],
    borderLeft: `2px solid ${theme.color.border}`,
  }),
  taskDesc: css({ fontSize: theme.fontSize.sm, color: theme.color.mutedForeground, lineHeight: 1.6 }),
  taskFiles: css({
    marginTop: theme.space[1.5],
    display: "flex",
    flexWrap: "wrap",
    gap: theme.space[1.5],
  }),
  taskFile: css({
    fontFamily: "var(--nx-ff-mono)",
    fontSize: "11px",
    color: inkQuiet,
    background: theme.color.muted,
    padding: "1px 6px",
    borderRadius: theme.radius.sm,
  }),
};
