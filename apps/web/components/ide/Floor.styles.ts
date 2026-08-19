"use client";

// The Floor's styles, on @yugnex/core. Same 1:1 key-name convention as
// IDE.styles.ts — see that file's header for why.

import { css, keyframes, themeVars as theme } from "@yugnex/core";

const ease = theme.easing.standard;
const inkQuiet = `color-mix(in srgb, ${theme.color.mutedForeground} 62%, transparent)`;
const lineFaint = "color-mix(in srgb, white 7%, transparent)";
const lineBright = "color-mix(in srgb, white 30%, transparent)";

// Defined ahead of stationClass so its generated class name can be targeted
// by a descendant selector below — two separately-atomic classes have no
// cascade relationship otherwise (the CSS-module ".station:hover .node"
// rule this replaces relied on both living in the same stylesheet).
const nodeClass = css({
  fill: theme.color.background,
  stroke: "color-mix(in srgb, white 16%, transparent)",
  strokeWidth: 1,
  transition: `fill ${theme.duration.slow} ${ease}, stroke ${theme.duration.slow} ${ease}`,
});

const haloOut = keyframes({
  "0%":   { opacity: 0.3, r: "7" },
  "100%": { opacity: 0,   r: "22" },
});

export const floor = {
  wrap: css({ display: "grid", gridTemplateRows: "auto 1fr auto", height: "100%", minHeight: 0 }),
  svg: css({ width: "100%", height: "100%", minHeight: 0, display: "block" }),

  // ── Legend ───────────────────────────────────────────────────────────
  legend: css({ display: "flex", alignItems: "center", gap: "18px", padding: "2px 24px 14px" }),
  legendItem: css({ display: "inline-flex", alignItems: "center", gap: "7px", fontSize: "12.5px", color: inkQuiet }),
  swatch: css({ width: "12px", height: "1px", display: "inline-block" }),
  swatchFlow: css({ background: lineBright }),
  swatchAttack: css({ background: theme.color.destructive }),
  legendCount: css({ marginLeft: "auto", fontSize: "12.5px", color: inkQuiet, fontVariantNumeric: "tabular-nums" }),

  bandLabel: css({
    fill: inkQuiet,
    fontFamily: "var(--nx-ff-sans)",
    fontSize: "11px",
    fontWeight: 450,
    letterSpacing: 0,
    textAnchor: "middle",
  }),

  // ── Edges ────────────────────────────────────────────────────────────
  edge: css({ fill: "none", stroke: lineFaint, strokeWidth: 1, transition: `stroke ${theme.duration.slow} ${ease}` }),
  edgeLive: css({ stroke: lineBright }),

  attack: css({ fill: "none", stroke: "transparent", strokeWidth: 1, transition: `stroke ${theme.duration.slow} ${ease}` }),
  attackLive: css({ stroke: `color-mix(in srgb, ${theme.color.destructive} 50%, transparent)` }),

  // ── Stations ─────────────────────────────────────────────────────────
  station: css({
    cursor: "pointer",
    "&:focus-visible": { outline: "none" },
    [`&:hover .${nodeClass}`]: { stroke: "color-mix(in srgb, white 34%, transparent)" },
  }),
  node: nodeClass,
  nodeAttack: css({}),
  nodeActive: css({ fill: theme.color.success, stroke: theme.color.success }),
  nodeError: css({ fill: theme.color.destructive, stroke: theme.color.destructive }),
  nodeSelected: css({ stroke: theme.color.foreground, strokeWidth: 1.5 }),

  pulse: css({
    fill: "none",
    stroke: theme.color.success,
    opacity: 0,
    animation: `${haloOut} 2.8s ${ease} infinite`,
    "@media (prefers-reduced-motion: reduce)": { animation: "none", opacity: 0.22 },
  }),

  nodeName: css({
    fill: theme.color.mutedForeground,
    fontFamily: "var(--nx-ff-sans)",
    fontSize: "12.5px",
    fontWeight: 450,
    textAnchor: "middle",
    pointerEvents: "none",
    letterSpacing: "-0.01em",
  }),
  nodeMeta: css({
    fill: inkQuiet,
    fontFamily: "var(--nx-ff-sans)",
    fontSize: "11.5px",
    textAnchor: "middle",
    pointerEvents: "none",
    fontVariantNumeric: "tabular-nums",
  }),

  caption: css({ padding: "14px 24px 18px", fontSize: theme.fontSize.sm, color: inkQuiet, textAlign: "center" }),
};
