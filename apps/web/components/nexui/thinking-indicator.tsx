"use client";

import { css, keyframes, themeVars as theme } from "@yugnex/core";
import type { HTMLAttributes, ReactNode } from "react";

const bounce = keyframes({
  "0%, 80%, 100%": { transform: "translateY(0)", opacity: 0.4 },
  "40%": { transform: "translateY(-4px)", opacity: 1 },
});

const shimmer = keyframes({
  "0%": { backgroundPosition: "200% 0" },
  "100%": { backgroundPosition: "-200% 0" },
});

const rootClass = css({
  display: "inline-flex",
  alignItems: "center",
  gap: theme.space[2],
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.sm,
});

const dotsClass = css({
  display: "inline-flex",
  gap: "3px",
  alignItems: "center",
});

const dotClass = css({
  width: "6px",
  height: "6px",
  borderRadius: "9999px",
  backgroundColor: "currentColor",
  animation: `${bounce} 1.2s ease-in-out infinite`,
});

const labelClass = css({
  // A moving highlight over the label reads as "working" even when the dots
  // are stilled by prefers-reduced-motion (the global reduce rule collapses
  // animation duration, leaving the text legible rather than blank).
  background: `linear-gradient(90deg, ${theme.color.mutedForeground} 0%, ${theme.color.foreground} 50%, ${theme.color.mutedForeground} 100%)`,
  backgroundSize: "200% 100%",
  backgroundClip: "text",
  WebkitBackgroundClip: "text",
  color: "transparent",
  animation: `${shimmer} 2s linear infinite`,
});

const plainLabelClass = css({ color: theme.color.mutedForeground });

export interface ThinkingIndicatorProps extends HTMLAttributes<HTMLSpanElement> {
  /** Text shown next to the dots. Pass `null` for dots only. */
  label?: ReactNode;
  /** Animate the label with a moving highlight. */
  shimmerLabel?: boolean;
}

/** The "model is working" state: three bouncing dots with an optional shimmering label. */
export function ThinkingIndicator({
  label = "Thinking",
  shimmerLabel = true,
  className,
  ...props
}: ThinkingIndicatorProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={className ? `${rootClass} ${className}` : rootClass}
      {...props}
    >
      <span className={dotsClass} aria-hidden="true">
        <span className={dotClass} />
        <span className={dotClass} style={{ animationDelay: "0.15s" }} />
        <span className={dotClass} style={{ animationDelay: "0.3s" }} />
      </span>
      {label ? <span className={shimmerLabel ? labelClass : plainLabelClass}>{label}</span> : null}
    </span>
  );
}
