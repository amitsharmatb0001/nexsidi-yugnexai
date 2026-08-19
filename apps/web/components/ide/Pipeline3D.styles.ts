"use client";

// Pipeline3D's styles, on @yugnex/core. Same 1:1 key-name convention as
// IDE.styles.ts.
//
// The CSS-module version let slabPast/slabCurrent/slabFail override a shared
// --slab-line custom property on the base .slab rule. Atomic classes don't
// carry that indirection as cleanly, so each state gets a complete,
// self-contained declaration instead — and since slabCurrent+slabFail can
// both be applied to the same element at once (a slab that is both "current"
// and "failed"), slabFail is defined AFTER slabCurrent below so its rule
// lands later in the stylesheet and wins at equal specificity, same as the
// DOM-order-independent cascade the original relied on.

import { css, themeVars as theme } from "@yugnex/core";

const ease = theme.easing.standard;

const slabLabelClass = css({
  fontSize: "11px",
  fontWeight: theme.fontWeight.medium,
  color: theme.color.mutedForeground,
  letterSpacing: "-0.01em",
});

export const pipeline3d = {
  stage3d: css({
    perspective: "420px",
    perspectiveOrigin: "50% 50%",
    height: "30px",
    display: "flex",
    alignItems: "center",
    "@media (max-width: 1100px)": { display: "none" },
  }),

  plane: css({
    display: "flex",
    alignItems: "center",
    gap: "5px",
    transformStyle: "preserve-3d",
    // A slight tilt is what makes the recession readable; without it
    // translateZ only changes scale and reads as a size glitch.
    transform: "rotateX(11deg) rotateY(-13deg)",
  }),

  slab: css({
    padding: "4px 9px",
    borderRadius: theme.radius.sm,
    border: "1px solid color-mix(in srgb, white 12%, transparent)",
    background: "color-mix(in srgb, white 2%, transparent)",
    whiteSpace: "nowrap",
    transition: `transform 520ms ${ease}, opacity 520ms ${ease}, border-color ${theme.duration.slow} ease, background ${theme.duration.slow} ease`,
    "@media (prefers-reduced-motion: reduce)": { transition: "none" },
  }),

  slabLabel: slabLabelClass,

  slabPast: css({
    borderColor: "color-mix(in srgb, white 7%, transparent)",
  }),

  slabCurrent: css({
    borderColor: `color-mix(in srgb, ${theme.color.primary} 55%, transparent)`,
    background: `color-mix(in srgb, ${theme.color.primary} 10%, transparent)`,
    [`& .${slabLabelClass}`]: { color: theme.color.foreground },
  }),

  // Defined after slabCurrent — see file header. Both are single-class
  // selectors of equal specificity, so later-in-stylesheet wins when a slab
  // is current AND failed.
  slabFail: css({
    borderColor: `color-mix(in srgb, ${theme.color.destructive} 60%, transparent)`,
    background: `color-mix(in srgb, ${theme.color.destructive} 10%, transparent)`,
    [`& .${slabLabelClass}`]: { color: theme.color.destructive },
  }),
};
