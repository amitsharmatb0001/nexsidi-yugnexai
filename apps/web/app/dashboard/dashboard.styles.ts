"use client";

// YugNex dashboard — styles on @yugnex/core, matching the IDE's tokens so
// entering a project is continuous rather than a jump between two products.
// Same 1:1 key-name convention as components/ide/IDE.styles.ts.
//
// This is a dashboard now, not a "describe your app" landing page: no large
// prompt box. Describing a new app happens in the planning chat a fresh
// project opens into (app/build/[id]/page.tsx's phase==="planning" view) —
// this page's job is account + the project list.

import { css, keyframes, themeVars as theme } from "@yugnex/core";

const ease = theme.easing.standard;
const inkQuiet = `color-mix(in srgb, ${theme.color.mutedForeground} 62%, transparent)`;

const cardIn = keyframes({
  from: { opacity: 0, transform: "translateY(3px)" },
  to: { opacity: 1, transform: "none" },
});

const pulse = keyframes({
  "0%, 100%": { opacity: 1 },
  "50%": { opacity: 0.35 },
});

// Defined ahead of projectRow so its resolved class name can be targeted by
// a descendant selector below — two independently-atomic classes have no
// cascade relationship otherwise (the CSS-module ".row:hover .actions" rule
// this replaces relied on both living in the same stylesheet). Kept visible
// on focus too, not just hover, so the actions are reachable by keyboard.
const rowActionsClass = css({
  display: "flex",
  alignItems: "center",
  gap: "2px",
  flex: "none",
  opacity: 0,
  transition: `opacity ${theme.duration.fast} ${ease}`,
});

export const dashboard = {
  root: css({
    position: "relative",
    display: "grid",
    gridTemplateRows: "48px 1fr",
    minHeight: "100dvh",
    background: theme.color.background,
    color: theme.color.foreground,
    fontSize: theme.fontSize.sm,
    letterSpacing: "-0.01em",
  }),

  // ── Title bar — identical to the workspace's ──────────────────────────
  nav: css({
    position: "relative",
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    gap: "14px",
    padding: "0 14px",
    borderBottom: `1px solid ${theme.color.border}`,
  }),
  navBrand: css({
    display: "inline-flex",
    alignItems: "center",
    gap: theme.space[2],
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.color.foreground,
  }),
  navLogo: css({ color: theme.color.primary, display: "inline-flex" }),
  navRight: css({ marginLeft: "auto", display: "flex", alignItems: "center", gap: theme.space[2] }),

  // ── Account ──────────────────────────────────────────────────────────
  account: css({ position: "relative" }),
  accountBtn: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[2],
    padding: "4px 8px 4px 4px",
    borderRadius: theme.radius.full,
    transition: `background ${theme.duration.base} ${ease}`,
    "&:hover": { background: theme.color.card },
  }),
  accountAvatar: css({
    width: "26px",
    height: "26px",
    flex: "none",
    display: "grid",
    placeItems: "center",
    borderRadius: theme.radius.full,
    background: theme.color.muted,
    color: theme.color.mutedForeground,
    fontSize: "11.5px",
    fontWeight: theme.fontWeight.semibold,
  }),
  accountName: css({
    fontSize: "12.5px",
    color: theme.color.mutedForeground,
    maxWidth: "140px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    "@media (max-width: 620px)": { display: "none" },
  }),
  accountMenu: css({
    position: "absolute",
    top: "36px",
    right: 0,
    minWidth: "200px",
    padding: theme.space[1],
    borderRadius: theme.radius.md,
    border: `1px solid ${theme.color.border}`,
    background: theme.color.card,
    boxShadow: theme.shadow.lg,
    zIndex: theme.zIndex.dropdown,
    animation: `${cardIn} ${theme.duration.fast} ${ease} both`,
  }),
  accountMenuEmail: css({
    padding: "8px 10px 6px",
    fontSize: "12px",
    color: inkQuiet,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    borderBottom: `1px solid ${theme.color.border}`,
    marginBottom: theme.space[1],
  }),
  accountMenuItem: css({
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "8px 10px",
    borderRadius: theme.radius.sm,
    fontSize: theme.fontSize.sm,
    color: theme.color.mutedForeground,
    transition: `background ${theme.duration.fast} ${ease}, color ${theme.duration.fast} ${ease}`,
    "&:hover": { background: theme.color.muted, color: theme.color.foreground },
  }),
  accountMenuItemAlert: css({ "&:hover": { background: `color-mix(in srgb, ${theme.color.destructive} 10%, transparent)`, color: theme.color.destructive } }),

  // ── Main ─────────────────────────────────────────────────────────────
  main: css({
    position: "relative",
    zIndex: 1,
    width: "100%",
    maxWidth: "760px",
    margin: "0 auto",
    padding: "56px 24px 80px",
    display: "flex",
    flexDirection: "column",
    gap: theme.space[10],
    "@media (max-width: 620px)": { padding: "36px 18px 56px" },
  }),

  errorBanner: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[2],
    padding: `${theme.space[2.5]} ${theme.space[3]}`,
    borderRadius: theme.radius.md,
    background: `color-mix(in srgb, ${theme.color.destructive} 10%, transparent)`,
    color: theme.color.destructive,
    fontSize: theme.fontSize.sm,
  }),

  // ── Section header ───────────────────────────────────────────────────
  sectionHead: css({
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.space[3],
    paddingBottom: theme.space[2.5],
    borderBottom: `1px solid ${theme.color.border}`,
  }),
  sectionTitleGroup: css({ display: "flex", alignItems: "baseline", gap: theme.space[2] }),
  sectionTitle: css({ fontSize: theme.fontSize.lg, fontWeight: theme.fontWeight.semibold, letterSpacing: "-0.02em" }),
  sectionCount: css({ fontSize: "12.5px", color: inkQuiet, fontVariantNumeric: "tabular-nums" }),
  liveTicker: css({
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "12px",
    color: theme.color.primary,
  }),
  liveDot: css({
    width: "5px",
    height: "5px",
    borderRadius: theme.radius.full,
    background: "currentColor",
    animation: `${pulse} 1.4s ${ease} infinite`,
  }),

  // Glow only on hover — matches the IDE's own gate button (IDE.styles.ts
  // `btn`), both modelled on yugnex.com's .glow-button-primary treatment.
  newBtn: css({
    display: "inline-flex",
    alignItems: "center",
    gap: theme.space[1.5],
    padding: "7px 13px",
    borderRadius: theme.radius.md,
    background: theme.color.foreground,
    color: theme.color.background,
    fontSize: "12.5px",
    fontWeight: theme.fontWeight.semibold,
    whiteSpace: "nowrap",
    boxShadow: "0 0 0 0 transparent",
    transition: `opacity ${theme.duration.base} ${ease}, box-shadow ${theme.duration.base} ${ease}`,
    "&:hover": {
      opacity: 0.86,
      boxShadow: `0 0 16px color-mix(in srgb, ${theme.color.primary} 45%, transparent)`,
    },
  }),

  // ── Projects ─────────────────────────────────────────────────────────
  projectGrid: css({ display: "flex", flexDirection: "column" }),

  projectRow: css({
    display: "flex",
    alignItems: "center",
    gap: "14px",
    padding: "13px 10px",
    borderBottom: `1px solid ${theme.color.border}`,
    borderRadius: theme.radius.sm,
    transition: `background ${theme.duration.base} ${ease}`,
    animation: `${cardIn} ${theme.duration.slow} ${ease} both`,
    "&:hover": { background: theme.color.card },
    [`&:hover .${rowActionsClass}`]: { opacity: 1 },
    [`&:focus-within .${rowActionsClass}`]: { opacity: 1 },
  }),

  projectLink: css({ display: "flex", alignItems: "center", flex: 1, minWidth: 0, gap: "14px", color: "inherit", textDecoration: "none", "&:hover": { textDecoration: "none" } }),
  projectMeta: css({ flex: 1, minWidth: 0 }),
  projectName: css({ fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.medium, color: theme.color.foreground }),
  projectDesc: css({
    marginTop: "2px",
    fontSize: "12.5px",
    color: inkQuiet,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    "@media (max-width: 620px)": { display: "none" },
  }),

  projectStatus: css({ display: "inline-flex", alignItems: "center", gap: "7px", fontSize: "12.5px", color: inkQuiet, flex: "none" }),
  // Status colour is applied directly to the dot at the call site rather
  // than via a ".done .statusDot" descendant rule — atomic classes don't
  // share a stylesheet the way two CSS-module classes did.
  statusDotDone: css({ width: "5px", height: "5px", borderRadius: theme.radius.full, background: theme.color.success }),
  statusDotBuilding: css({
    width: "5px",
    height: "5px",
    borderRadius: theme.radius.full,
    background: theme.color.primary,
    animation: `${pulse} 1.4s ${ease} infinite`,
  }),
  statusDotFailed: css({ width: "5px", height: "5px", borderRadius: theme.radius.full, background: theme.color.destructive }),

  projectTime: css({
    width: "64px",
    textAlign: "right",
    fontSize: "12.5px",
    color: inkQuiet,
    fontVariantNumeric: "tabular-nums",
    flex: "none",
    "@media (max-width: 620px)": { display: "none" },
  }),

  // Row actions — hidden until the row is hovered or focused (see
  // projectRow's own hover/focus-within rules above, which target this
  // exact class), so the list reads clean at rest.
  rowActions: rowActionsClass,
  iconBtn: css({
    display: "grid",
    placeItems: "center",
    width: "26px",
    height: "26px",
    borderRadius: theme.radius.sm,
    color: inkQuiet,
    transition: `color ${theme.duration.fast} ${ease}, background ${theme.duration.fast} ${ease}`,
    "&:hover": { color: theme.color.mutedForeground, background: theme.color.muted },
  }),
  iconBtnDanger: css({ "&:hover": { color: theme.color.destructive, background: `color-mix(in srgb, ${theme.color.destructive} 10%, transparent)` } }),

  // Inline rename
  renameInput: css({
    flex: 1,
    minWidth: 0,
    padding: "3px 7px",
    borderRadius: theme.radius.sm,
    border: `1px solid ${theme.color.ring}`,
    background: theme.color.background,
    color: theme.color.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    outline: "none",
  }),

  // Inline delete confirm — replaces the row's content, no native dialog.
  confirmRow: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[2.5],
    padding: "13px 10px",
    borderBottom: `1px solid ${theme.color.border}`,
    borderRadius: theme.radius.sm,
    background: `color-mix(in srgb, ${theme.color.destructive} 6%, transparent)`,
  }),
  confirmText: css({ flex: 1, fontSize: theme.fontSize.sm, color: theme.color.foreground }),
  confirmBtn: css({
    padding: "5px 11px",
    borderRadius: theme.radius.sm,
    fontSize: "12.5px",
    fontWeight: theme.fontWeight.semibold,
    background: theme.color.destructive,
    color: theme.color.destructiveForeground,
    transition: `opacity ${theme.duration.base} ${ease}`,
    "&:hover": { opacity: 0.85 },
  }),
  cancelBtn: css({
    padding: "5px 11px",
    borderRadius: theme.radius.sm,
    fontSize: "12.5px",
    color: inkQuiet,
    "&:hover": { color: theme.color.mutedForeground },
  }),

  empty: css({
    padding: "40px 10px",
    textAlign: "center",
    color: inkQuiet,
    fontSize: theme.fontSize.sm,
  }),

  skeleton: css({ height: "14px", borderRadius: theme.radius.sm, background: theme.color.muted }),
};
