"use client";

// The real YugNex mark's presentation — a soft breathing halo plus an
// alpha-aware edge glow, both keyed off the platform's own primary token so
// the mark reads as part of the same accent language as buttons and status
// dots, not a second competing gold. Modelled on yugnex.com's own
// glow-button-primary/pulse treatment (soft radial halo behind the shape,
// slow pulse) — brought over as the platform's answer to that same
// "enchanted, alive" quality, scaled down for a mark worn at 19-22px in a
// dense workspace rather than a landing-page hero.

import { css, keyframes, themeVars as theme } from "@yugnex/core";

const breathe = keyframes({
  "0%, 100%": { opacity: 0.32, transform: "scale(0.9)" },
  "50%": { opacity: 0.6, transform: "scale(1.12)" },
});

export const logo = {
  mark: css({
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  }),
  // A blurred radial halo sitting behind the glyph. Box-shadow would glow a
  // rectangle; this is its own layer so it stays circular regardless of the
  // mark's actual (non-square) silhouette.
  halo: css({
    position: "absolute",
    inset: "-45%",
    borderRadius: theme.radius.full,
    background: `radial-gradient(circle, ${theme.color.primary} 0%, transparent 68%)`,
    filter: "blur(5px)",
    animation: `${breathe} 3.4s ${theme.easing.standard} infinite`,
    pointerEvents: "none",
  }),
  // drop-shadow (not box-shadow) follows the PNG's own alpha channel, so the
  // glow hugs the arch-and-N shape itself rather than its bounding box.
  img: css({
    position: "relative",
    display: "block",
    filter: `drop-shadow(0 0 3px color-mix(in srgb, ${theme.color.primary} 60%, transparent))`,
  }),
};
