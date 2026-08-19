"use client";

// YugNex start screen — styles on @yugnex/core, matching the IDE's tokens
// so entering a project is continuous rather than a jump between two
// products. Same 1:1 key-name convention as components/ide/IDE.styles.ts.

import { css, keyframes, themeVars as theme } from "@yugnex/core";

const ease = theme.easing.standard;
const inkQuiet = `color-mix(in srgb, ${theme.color.mutedForeground} 62%, transparent)`;

const cardIn = keyframes({
  from: { opacity: 0, transform: "translateY(3px)" },
  to: { opacity: 1, transform: "none" },
});

export const dashboard = {
  root: css({
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
  navAvatar: css({
    width: "26px",
    height: "26px",
    display: "grid",
    placeItems: "center",
    borderRadius: theme.radius.full,
    background: theme.color.muted,
    color: inkQuiet,
    fontSize: "12px",
  }),

  // ── Main ───────────────────────────────────────────────────────────────
  main: css({
    width: "100%",
    maxWidth: "760px",
    margin: "0 auto",
    padding: "76px 24px 80px",
    display: "flex",
    flexDirection: "column",
    gap: theme.space[16] ?? "56px",
    "@media (max-width: 620px)": {
      padding: "44px 18px 56px",
      gap: theme.space[10],
    },
  }),

  // ── Prompt ───────────────────────────────────────────────────────────
  newProjectCard: css({ display: "flex", flexDirection: "column", gap: "14px" }),
  newProjectTitle: css({
    fontSize: theme.fontSize["3xl"],
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: "-0.03em",
    textWrap: "balance",
    "@media (max-width: 620px)": { fontSize: theme.fontSize["2xl"] },
  }),
  newProjectSub: css({ fontSize: theme.fontSize.sm, color: inkQuiet, lineHeight: 1.6, maxWidth: "62ch" }),
  kbd: css({
    marginLeft: theme.space[2],
    padding: "1px 6px",
    borderRadius: theme.radius.sm,
    border: `1px solid ${theme.color.border}`,
    fontSize: "11.5px",
    color: inkQuiet,
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

  // The field is the page's one bold element — everything else stays quiet.
  inputRow: css({
    display: "flex",
    flexDirection: "column",
    gap: theme.space[2.5],
    padding: "14px",
    borderRadius: theme.radius.lg,
    border: `1px solid ${theme.color.border}`,
    background: theme.color.card,
    transition: `border-color ${theme.duration.base} ${ease}`,
    "&:focus-within": { borderColor: `color-mix(in srgb, ${theme.color.primary} 55%, transparent)` },
  }),
  textarea: css({
    width: "100%",
    border: "none",
    background: "none",
    color: theme.color.foreground,
    fontFamily: "inherit",
    fontSize: theme.fontSize.base,
    lineHeight: 1.55,
    resize: "none",
    outline: "none",
    "&::placeholder": { color: inkQuiet },
  }),

  inputActions: css({ display: "flex", alignItems: "center", gap: theme.space[2.5] }),
  inputHint: css({ fontSize: "12.5px", color: inkQuiet }),

  buildBtn: css({
    marginLeft: "auto",
    padding: `${theme.space[2]} 18px`,
    borderRadius: theme.radius.md,
    background: theme.color.foreground,
    color: theme.color.background,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    transition: `opacity ${theme.duration.base} ${ease}`,
    "&:hover:not(:disabled)": { opacity: 0.86 },
    "&:disabled": { opacity: 0.32, cursor: "not-allowed" },
  }),

  // Examples read as suggestions, not as buttons competing with Build.
  examples: css({ display: "flex", flexWrap: "wrap", gap: "7px" }),
  exampleChip: css({
    padding: `${theme.space[1.5]} 11px`,
    borderRadius: theme.radius.full,
    border: `1px solid ${theme.color.border}`,
    background: "none",
    color: inkQuiet,
    fontSize: "12.5px",
    textAlign: "left",
    transition: `color ${theme.duration.base} ${ease}, border-color ${theme.duration.base} ${ease}`,
    "&:hover": { color: theme.color.mutedForeground, borderColor: theme.color.ring },
  }),

  // ── Projects ─────────────────────────────────────────────────────────
  sectionTitle: css({
    fontSize: "12.5px",
    color: inkQuiet,
    paddingBottom: theme.space[2.5],
    borderBottom: `1px solid ${theme.color.border}`,
  }),

  // A list, the way an editor lists recent work — not a grid of large cards.
  projectGrid: css({ display: "flex", flexDirection: "column" }),

  projectCard: css({
    display: "flex",
    alignItems: "center",
    gap: "14px",
    padding: "13px 10px",
    borderBottom: `1px solid ${theme.color.border}`,
    color: "inherit",
    textDecoration: "none",
    transition: `background ${theme.duration.base} ${ease}`,
    animation: `${cardIn} ${theme.duration.slow} ${ease} both`,
    "&:hover": { background: theme.color.card, textDecoration: "none" },
  }),

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

  projectStatus: css({ display: "inline-flex", alignItems: "center", gap: "7px", fontSize: "12.5px", color: inkQuiet }),
  // Status colour is applied directly to the dot at the call site (one of
  // the three below) rather than via a ".done .statusDot" descendant rule —
  // that relied on two rules sharing one stylesheet, which independently
  // hashed atomic classes don't.
  statusDot: css({ width: "5px", height: "5px", borderRadius: theme.radius.full, background: inkQuiet }),
  statusDotDone: css({ width: "5px", height: "5px", borderRadius: theme.radius.full, background: theme.color.success }),
  statusDotBuilding: css({ width: "5px", height: "5px", borderRadius: theme.radius.full, background: theme.color.primary }),
  statusDotFailed: css({ width: "5px", height: "5px", borderRadius: theme.radius.full, background: theme.color.destructive }),

  projectTime: css({
    width: "72px",
    textAlign: "right",
    fontSize: "12.5px",
    color: inkQuiet,
    fontVariantNumeric: "tabular-nums",
    "@media (max-width: 620px)": { display: "none" },
  }),

  empty: css({ padding: "26px 10px", color: inkQuiet, fontSize: theme.fontSize.sm }),

  skeleton: css({ height: "14px", borderRadius: theme.radius.sm, background: theme.color.muted }),
};
