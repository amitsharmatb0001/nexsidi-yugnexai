"use client";

// YugNex IDE — styles on @yugnex/core, the same engine Aanya generates every
// app against. Colour, spacing and radius come from themeVars (the running
// ThemeProvider) rather than a second, hand-rolled token set; the NexuiSans/
// NexuiMono font stacks stay wired through the platform's own --nx-ff-*
// custom properties (apps/web/app/globals.css), since those are real branded
// typefaces the theme engine has no opinion on, not a competing system.
//
// theme.space only defines 0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16,
// 20, 24 (indexing any other number is a type error against the real scale,
// not just a lint nit — confirmed live). Values the design wants in between
// two steps are literal px rather than forced onto the nearest token.
//
// Key names match the CSS-module classes this file replaces 1:1, so IDE.tsx
// keeps writing `s.row`, `s.tabActive`, etc. — only the styling engine
// underneath changed.

import { css, keyframes, themeVars as theme } from "@yugnex/core";

const ease = theme.easing.standard;

// A third, dimmer text tier derived FROM the theme's own mutedForeground
// rather than a hardcoded hex — it re-dims correctly if the mounted theme
// ever changes, which a literal colour value would not.
const inkQuiet = `color-mix(in srgb, ${theme.color.mutedForeground} 62%, transparent)`;

const fadeInUp = keyframes({
  from: { opacity: 0, transform: "translateY(3px)" },
  to: { opacity: 1, transform: "none" },
});

const writePulse = keyframes({
  "0%, 100%": { opacity: 1 },
  "50%": { opacity: 0.4 },
});

// Colour is set by `tab`'s own hover rule below (a descendant selector, so
// it only applies once); this only owns the background highlight for
// hovering the × itself, which doesn't conflict with the parent's rule
// since the two touch different properties.
const tabCloseClass = css({
  display: "grid",
  placeItems: "center",
  width: "16px",
  height: "16px",
  borderRadius: theme.radius.sm,
  fontSize: "13px",
  lineHeight: 1,
  color: "transparent",
  transition: `color ${theme.duration.fast} ${ease}, background ${theme.duration.fast} ${ease}`,
  "&:hover": { background: theme.color.muted },
});

// Same "define first, reference via computed key" technique — hidden until
// the Changes row itself is hovered (see `row`'s own hover rule below).
const diffRowActionsClass = css({
  display: "flex",
  alignItems: "center",
  gap: "1px",
  flex: "none",
  marginLeft: "auto",
  opacity: 0,
  transition: `opacity ${theme.duration.fast} ${ease}`,
});

export const ide = {
  root: css({
    display: "grid",
    gridTemplateRows: "48px 1fr 26px",
    height: "100dvh",
    background: theme.color.background,
    color: theme.color.foreground,
    overflow: "hidden",
    fontFamily: "var(--nx-ff-sans)",
    fontSize: theme.fontSize.sm,
    letterSpacing: "-0.01em",
  }),

  // ── Title bar ────────────────────────────────────────────────────────
  titlebar: css({
    display: "flex",
    alignItems: "center",
    gap: "14px",
    padding: "0 14px",
    borderBottom: `1px solid ${theme.color.border}`,
  }),
  brand: css({
    display: "inline-flex",
    alignItems: "center",
    gap: theme.space[2],
    color: theme.color.foreground,
    textDecoration: "none",
    fontWeight: theme.fontWeight.semibold,
    fontSize: theme.fontSize.base,
    transition: `opacity ${theme.duration.base} ${ease}`,
    "&:hover": { textDecoration: "none", opacity: 0.8 },
  }),
  brandMark: css({ color: theme.color.primary, display: "inline-flex" }),
  project: css({
    display: "flex",
    alignItems: "center",
    gap: "9px",
    minWidth: 0,
    color: theme.color.mutedForeground,
  }),
  projectSep: css({ color: inkQuiet }),
  projectName: css({ color: theme.color.foreground, fontWeight: theme.fontWeight.medium }),
  titleRight: css({ marginLeft: "auto", display: "flex", alignItems: "center", gap: theme.space[3] }),
  openBtn: css({
    padding: `${theme.space[1.5]} ${theme.space[3]}`,
    borderRadius: theme.radius.sm,
    background: theme.color.foreground,
    color: theme.color.background,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    textDecoration: "none",
    transition: `opacity ${theme.duration.base} ${ease}`,
    "&:hover": { opacity: 0.85, textDecoration: "none" },
  }),

  // ── Workbench ────────────────────────────────────────────────────────
  workbench: css({
    display: "grid",
    gridTemplateColumns: "46px 244px minmax(0, 1fr) 300px",
    minHeight: 0,
    overflow: "hidden",
    "@media (max-width: 1240px)": {
      gridTemplateColumns: "46px 220px minmax(0, 1fr) 0",
    },
    "@media (max-width: 900px)": {
      gridTemplateColumns: "46px minmax(0, 1fr) 0 0",
    },
  }),

  activity: css({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "3px",
    padding: `${theme.space[2]} 0`,
    borderRight: `1px solid ${theme.color.border}`,
  }),
  actBtn: css({
    position: "relative",
    width: "34px",
    height: "34px",
    display: "grid",
    placeItems: "center",
    borderRadius: theme.radius.sm,
    color: inkQuiet,
    transition: `color ${theme.duration.base} ${ease}, background ${theme.duration.base} ${ease}`,
    "&:hover": { color: theme.color.mutedForeground, background: theme.color.card },
  }),
  actBtnActive: css({ color: theme.color.foreground, background: theme.color.muted }),
  actDot: css({
    position: "absolute",
    top: "6px",
    right: "6px",
    width: "5px",
    height: "5px",
    borderRadius: theme.radius.full,
    background: theme.color.success,
  }),
  actDotAlert: css({ background: theme.color.destructive }),

  side: css({
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    borderRight: `1px solid ${theme.color.border}`,
    background: theme.color.card,
  }),
  sideHead: css({
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.space[2],
    padding: "13px 14px 9px",
    fontSize: theme.fontSize.xs,
    color: inkQuiet,
  }),
  sideCount: css({ fontVariantNumeric: "tabular-nums" }),
  sideBody: css({ flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: theme.space[4] }),

  // ── Explorer tree ────────────────────────────────────────────────────
  row: css({
    display: "flex",
    alignItems: "center",
    gap: "7px",
    width: "100%",
    textAlign: "left",
    padding: "3.5px 10px",
    fontSize: theme.fontSize.sm,
    color: theme.color.mutedForeground,
    cursor: "pointer",
    transition: `background ${theme.duration.fast} ${ease}`,
    "&:hover": { background: theme.color.muted },
    [`&:hover .${diffRowActionsClass}`]: { opacity: 1 },
  }),
  rowSelected: css({ background: theme.color.muted, color: theme.color.foreground }),
  caret: css({
    flex: "none",
    width: "11px",
    color: inkQuiet,
    fontSize: "9px",
    transition: `transform ${theme.duration.base} ${ease}`,
  }),
  caretOpen: css({ transform: "rotate(90deg)" }),
  mark: css({
    flex: "none",
    width: "17px",
    fontFamily: "var(--nx-ff-mono)",
    fontSize: "9.5px",
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: "-0.03em",
    textAlign: "center",
    opacity: 0.85,
  }),
  tabMark: css({
    flex: "none",
    fontFamily: "var(--nx-ff-mono)",
    fontSize: "9.5px",
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: "-0.03em",
    opacity: 0.85,
  }),
  folderMark: css({ flex: "none", width: "17px", textAlign: "center", color: inkQuiet, fontSize: theme.fontSize.xs }),
  name: css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
  nameFresh: css({ color: theme.color.success }),
  dirName: css({ color: theme.color.mutedForeground, fontWeight: theme.fontWeight.medium }),
  // An ancestor folder of a file being written right now — quiet tint, no
  // pulse, so attention still lands on the file itself rather than every
  // folder up the tree competing for it.
  dirNameActive: css({ color: theme.color.primary }),
  freshPip: css({
    flex: "none",
    marginLeft: "auto",
    width: "4px",
    height: "4px",
    borderRadius: theme.radius.full,
    background: theme.color.success,
  }),
  // A file with a write call inside the live recency window — distinct from
  // the static "freshly written" green (nameFresh/freshPip): this pulses,
  // because content is changing right now, not settled a moment ago.
  nameWriting: css({ color: theme.color.primary, animation: `${writePulse} 1.1s ${ease} infinite` }),
  writingPip: css({
    flex: "none",
    marginLeft: "auto",
    width: "4px",
    height: "4px",
    borderRadius: theme.radius.full,
    background: theme.color.primary,
    animation: `${writePulse} 1.1s ${ease} infinite`,
  }),
  diffStat: css({
    display: "flex",
    gap: "7px",
    fontFamily: "var(--nx-ff-mono)",
    fontSize: "11px",
    fontVariantNumeric: "tabular-nums",
  }),
  add: css({ color: theme.color.success }),
  del: css({ color: theme.color.destructive }),

  // ── Changes: accept/reject ───────────────────────────────────────────
  diffToolbar: css({
    display: "flex",
    gap: theme.space[2],
    padding: "0 14px 10px",
  }),
  diffToolbarBtn: css({
    flex: 1,
    padding: "5px 0",
    borderRadius: theme.radius.sm,
    border: `1px solid ${theme.color.border}`,
    fontSize: "12px",
    fontWeight: theme.fontWeight.medium,
    color: theme.color.mutedForeground,
    transition: `background ${theme.duration.fast} ${ease}, color ${theme.duration.fast} ${ease}`,
    "&:hover": { background: theme.color.muted, color: theme.color.foreground },
  }),
  diffToolbarBtnDanger: css({
    "&:hover": { background: `color-mix(in srgb, ${theme.color.destructive} 10%, transparent)`, color: theme.color.destructive },
  }),
  diffToolbarConfirm: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[2],
    padding: "8px 14px",
    margin: "0 0 10px",
    fontSize: "12px",
    color: theme.color.foreground,
    background: `color-mix(in srgb, ${theme.color.destructive} 8%, transparent)`,
  }),
  diffConfirmSpacer: css({ flex: 1 }),

  diffStatusBadge: css({
    flex: "none",
    width: "13px",
    fontFamily: "var(--nx-ff-mono)",
    fontSize: "10px",
    fontWeight: theme.fontWeight.semibold,
    textAlign: "center",
  }),
  statusAdded: css({ color: theme.color.success }),
  statusModified: css({ color: theme.color.warning }),
  statusDeleted: css({ color: theme.color.destructive }),

  rowReviewed: css({ opacity: 0.5 }),
  reviewedCheck: css({ flex: "none", color: theme.color.success, display: "inline-flex" }),

  // Defined ahead of `row` so its resolved class name can be targeted by a
  // descendant hover selector below, same technique as `tabClose`.
  diffRowActions: diffRowActionsClass,
  iconBtnSm: css({
    display: "grid",
    placeItems: "center",
    width: "20px",
    height: "20px",
    borderRadius: theme.radius.sm,
    color: inkQuiet,
    transition: `color ${theme.duration.fast} ${ease}, background ${theme.duration.fast} ${ease}`,
    "&:hover": { color: theme.color.mutedForeground, background: theme.color.muted },
  }),
  iconBtnDangerSm: css({
    "&:hover": { color: theme.color.destructive, background: `color-mix(in srgb, ${theme.color.destructive} 10%, transparent)` },
  }),

  diffConfirmRow: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[2],
    padding: "3.5px 10px",
    fontSize: "12px",
    background: `color-mix(in srgb, ${theme.color.destructive} 8%, transparent)`,
  }),
  diffConfirmText: css({ flex: 1, color: theme.color.foreground, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
  diffConfirmCancel: css({ color: inkQuiet, padding: "2px 6px", "&:hover": { color: theme.color.mutedForeground } }),
  diffConfirmDanger: css({
    padding: "2px 8px",
    borderRadius: theme.radius.sm,
    fontWeight: theme.fontWeight.semibold,
    background: theme.color.destructive,
    color: theme.color.destructiveForeground,
    "&:hover": { opacity: 0.85 },
  }),

  // ── Editor ───────────────────────────────────────────────────────────
  editor: css({ display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0, minWidth: 0 }),
  tabbar: css({
    display: "flex",
    alignItems: "stretch",
    gap: "1px",
    minHeight: "36px",
    borderBottom: `1px solid ${theme.color.border}`,
    overflowX: "auto",
  }),
  // Defined ahead of `tab` so its resolved class name can be targeted by a
  // descendant selector below — two independently-atomic classes have no
  // cascade relationship otherwise. Hidden until the tab is hovered or
  // active; a strip of permanently visible × buttons on a dozen open tabs
  // reads as noise.
  tabClose: tabCloseClass,
  tab: css({
    display: "inline-flex",
    alignItems: "center",
    gap: theme.space[2],
    padding: "0 10px 0 14px",
    fontSize: theme.fontSize.sm,
    color: inkQuiet,
    whiteSpace: "nowrap",
    cursor: "pointer",
    borderRight: `1px solid ${theme.color.border}`,
    transition: `color ${theme.duration.base} ${ease}, background ${theme.duration.base} ${ease}`,
    "&:hover": { color: theme.color.mutedForeground },
    [`&:hover .${tabCloseClass}`]: { color: inkQuiet },
  }),
  tabActive: css({
    color: theme.color.foreground,
    background: theme.color.card,
    [`& .${tabCloseClass}`]: { color: inkQuiet },
  }),
  tabWriting: css({
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    marginLeft: theme.space[2],
    color: theme.color.primary,
    fontSize: "11px",
  }),
  tabWritingDot: css({
    width: "4px",
    height: "4px",
    borderRadius: theme.radius.full,
    background: "currentColor",
    animation: `${writePulse} 1.1s ${ease} infinite`,
  }),
  pane: css({ minHeight: 0, overflow: "auto" }),
  code: css({
    margin: 0,
    padding: "14px 18px 32px",
    fontFamily: "var(--nx-ff-mono)",
    fontSize: "12.5px",
    lineHeight: 1.7,
    color: theme.color.mutedForeground,
    whiteSpace: "pre",
    tabSize: 2,
  }),

  // Diff patch
  patch: css({ margin: 0, padding: `${theme.space[3]} 0 ${theme.space[8]}`, fontFamily: "var(--nx-ff-mono)", fontSize: "12.5px", lineHeight: 1.65 }),
  patchLine: css({ padding: "0 18px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: inkQuiet }),
  patchAdd: css({ background: `color-mix(in srgb, ${theme.color.success} 12%, transparent)`, color: theme.color.success }),
  patchDel: css({ background: `color-mix(in srgb, ${theme.color.destructive} 12%, transparent)`, color: theme.color.destructive }),
  patchHunk: css({ color: inkQuiet, background: theme.color.muted }),
  patchMeta: css({ color: inkQuiet, opacity: 0.7 }),

  frame: css({ width: "100%", height: "100%", border: 0, background: "#fff" }),

  empty: css({
    display: "grid",
    placeItems: "center",
    alignContent: "center",
    height: "100%",
    padding: "44px",
    textAlign: "center",
    gap: "7px",
  }),
  emptyTitle: css({ fontSize: theme.fontSize.lg, fontWeight: theme.fontWeight.medium, color: theme.color.mutedForeground }),
  emptyHint: css({ fontSize: theme.fontSize.sm, color: inkQuiet, maxWidth: "40ch", lineHeight: 1.6 }),

  // ── Narration ────────────────────────────────────────────────────────
  narration: css({
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    borderLeft: `1px solid ${theme.color.border}`,
    background: theme.color.card,
    overflow: "hidden",
  }),
  narrHead: css({
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    padding: "13px 16px 9px",
    fontSize: theme.fontSize.xs,
    color: inkQuiet,
  }),
  narrBody: css({ flex: 1, minHeight: 0, overflowY: "auto", padding: `${theme.space[1]} ${theme.space[4]} ${theme.space[5]}` }),

  thought: css({
    padding: "9px 0",
    borderBottom: `1px solid ${theme.color.border}`,
    animation: `${fadeInUp} ${theme.duration.slow} ${ease} both`,
    "&:last-child": { borderBottom: "none" },
  }),
  thoughtWho: css({
    display: "flex",
    alignItems: "center",
    gap: "7px",
    fontSize: "11.5px",
    color: inkQuiet,
    marginBottom: "3px",
  }),
  whoDot: css({ width: "4px", height: "4px", borderRadius: theme.radius.full, background: inkQuiet }),
  whoDotLive: css({ background: theme.color.success }),
  thoughtText: css({ fontSize: theme.fontSize.sm, lineHeight: 1.55, color: theme.color.mutedForeground }),
  thoughtDoing: css({ color: theme.color.foreground }),
  thoughtMeta: css({
    marginTop: "3px",
    fontFamily: "var(--nx-ff-mono)",
    fontSize: "11.5px",
    color: inkQuiet,
    overflowWrap: "anywhere",
  }),
  thoughtErr: css({ color: theme.color.destructive }),

  // ── Status bar ───────────────────────────────────────────────────────
  status: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[4],
    padding: "0 14px",
    borderTop: `1px solid ${theme.color.border}`,
    fontSize: theme.fontSize.xs,
    color: inkQuiet,
  }),
  statusItem: css({ display: "inline-flex", alignItems: "center", gap: "6px" }),
  statusDot: css({ width: "5px", height: "5px", borderRadius: theme.radius.full, background: "currentColor" }),
  statusDotLive: css({ width: "5px", height: "5px", borderRadius: theme.radius.full, background: theme.color.success }),
  statusLive: css({ color: theme.color.mutedForeground }),
  statusPush: css({ marginLeft: "auto" }),

  // ── Gate ─────────────────────────────────────────────────────────────
  gate: css({
    display: "flex",
    alignItems: "center",
    gap: "14px",
    padding: `${theme.space[2.5]} ${theme.space[4]}`,
    borderBottom: `1px solid ${theme.color.border}`,
    background: theme.color.muted,
  }),
  gateText: css({ flex: 1, minWidth: 0 }),
  gateTitle: css({ fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.semibold }),
  gateHint: css({ fontSize: theme.fontSize.xs, color: inkQuiet, marginTop: "1px" }),
  gateInput: css({
    minWidth: 0,
    maxWidth: "320px",
    flex: 1,
    padding: "7px 11px",
    borderRadius: theme.radius.sm,
    border: `1px solid ${theme.color.input}`,
    background: theme.color.background,
    color: theme.color.foreground,
    fontSize: theme.fontSize.sm,
    outline: "none",
    "&:focus": { borderColor: theme.color.ring },
  }),

  // Glow only on hover/focus — a permanent halo on a neutral foreground
  // button would fight the button's own colour rather than accent it.
  // Modelled on yugnex.com's .glow-button-primary (box-shadow: 0 0 15px
  // <accent>40) with the same alpha, keyed to the platform's primary token.
  btn: css({
    padding: "7px 14px",
    borderRadius: theme.radius.sm,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    whiteSpace: "nowrap",
    background: theme.color.foreground,
    color: theme.color.background,
    boxShadow: "0 0 0 0 transparent",
    transition: `opacity ${theme.duration.base} ${ease}, box-shadow ${theme.duration.base} ${ease}`,
    "&:hover:not(:disabled)": {
      opacity: 0.85,
      boxShadow: `0 0 16px color-mix(in srgb, ${theme.color.primary} 45%, transparent)`,
    },
    "&:disabled": { opacity: 0.4, cursor: "not-allowed" },
  }),
  btnGhost: css({
    background: "transparent",
    color: inkQuiet,
    "&:hover": { color: theme.color.mutedForeground, background: theme.color.muted },
  }),
};
