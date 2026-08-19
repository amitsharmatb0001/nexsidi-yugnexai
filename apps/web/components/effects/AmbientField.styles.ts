"use client";

// A quiet particle field, brought over from yugnex.com's own hero treatment
// (.particle-container / .particle / @keyframes particleFloat — read directly
// off the live site's shipped CSS) and re-tuned for a workspace someone sits
// in for hours rather than a hero section seen for seconds: far fewer
// particles, much lower opacity, gold-tinted to the platform's own primary
// token instead of the marketing site's blue, so it reads as ambient texture
// behind dense UI rather than competing with it.

import { css, keyframes, themeVars as theme } from "@yugnex/core";

const rise = keyframes({
  "0%": { opacity: 0, transform: "translate(0, 12vh) scale(0.6)" },
  "12%": { opacity: 1, transform: "translate(6px, 0vh) scale(1)" },
  "50%": { transform: "translate(-6px, -50vh) scale(1)" },
  "88%": { opacity: 1, transform: "translate(6px, -100vh) scale(1)" },
  "100%": { opacity: 0, transform: "translate(0, -112vh) scale(0.6)" },
});

export const field = {
  container: css({
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: 0,
    "@media (prefers-reduced-motion: reduce)": {
      display: "none",
    },
  }),
  particle: css({
    position: "absolute",
    bottom: 0,
    width: "2px",
    height: "2px",
    borderRadius: theme.radius.full,
    background: theme.color.primary,
    boxShadow: `0 0 6px color-mix(in srgb, ${theme.color.primary} 70%, transparent)`,
    opacity: 0,
    animation: `${rise} linear infinite`,
  }),
};
