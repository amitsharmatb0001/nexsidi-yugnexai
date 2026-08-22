"use client";

import { css, keyframes, themeVars as theme, tokens } from "@yugnex/core";

const driftA = keyframes({
  "0%": { transform: "translate(-10%, -10%) scale(1)" },
  "50%": { transform: "translate(10%, 5%) scale(1.15)" },
  "100%": { transform: "translate(-10%, -10%) scale(1)" },
});

const driftB = keyframes({
  "0%": { transform: "translate(5%, 10%) scale(1)" },
  "50%": { transform: "translate(-15%, -5%) scale(0.9)" },
  "100%": { transform: "translate(5%, 10%) scale(1)" },
});

const driftC = keyframes({
  "0%": { transform: "translate(0%, 0%) scale(1)" },
  "50%": { transform: "translate(8%, -12%) scale(1.1)" },
  "100%": { transform: "translate(0%, 0%) scale(1)" },
});

const containerClass = css({
  position: "absolute",
  inset: 0,
  overflow: "hidden",
  pointerEvents: "none",
  zIndex: 0,
  maskImage: "linear-gradient(to bottom, black, transparent)",
  WebkitMaskImage: "linear-gradient(to bottom, black, transparent)",
});

const blobBaseClass = css({
  position: "absolute",
  borderRadius: "9999px",
  filter: "blur(80px)",
  opacity: 0.3,
  willChange: "transform",
  '[data-theme="dark"] &': {
    opacity: 0.5,
  },
});

const blobAClass = css({
  top: "-12%",
  left: "2%",
  width: "36rem",
  height: "36rem",
  background: theme.color.primary,
  animation: `${driftA} 22s ease-in-out infinite`,
});

const blobBClass = css({
  top: "6%",
  right: "-4%",
  width: "30rem",
  height: "30rem",
  background: tokens.colorPrimitives.warning[300],
  animation: `${driftB} 26s ease-in-out infinite`,
});

const blobCClass = css({
  bottom: "-18%",
  left: "28%",
  width: "32rem",
  height: "32rem",
  background: tokens.colorPrimitives.success[300],
  animation: `${driftC} 30s ease-in-out infinite`,
});

export interface AuroraBackdropProps {
  className?: string;
}

/** Slow-drifting gradient-mesh blobs meant to sit behind hero-style content (parent needs `position: relative`). */
export function AuroraBackdrop({ className }: AuroraBackdropProps) {
  return (
    <div className={className ? `${containerClass} ${className}` : containerClass} aria-hidden="true">
      <div className={`${blobBaseClass} ${blobAClass}`} />
      <div className={`${blobBaseClass} ${blobBClass}`} />
      <div className={`${blobBaseClass} ${blobCClass}`} />
    </div>
  );
}
