"use client";

import { createVariants, keyframes, themeVars as theme } from "@yugnex/core";
import type { CSSProperties, HTMLAttributes } from "react";

const pulse = keyframes({
  "0%, 100%": { opacity: 1 },
  "50%": { opacity: 0.45 },
});

const shimmer = keyframes({
  "0%": { backgroundPosition: "200% 0" },
  "100%": { backgroundPosition: "-200% 0" },
});

const skeletonVariants = createVariants({
  base: {
    display: "block",
    backgroundColor: theme.color.muted,
  },
  variants: {
    shape: {
      text: { height: "0.85em", borderRadius: theme.radius.sm, margin: "0.2em 0" },
      circle: { borderRadius: "9999px" },
      rect: { borderRadius: theme.radius.md },
    },
    animation: {
      pulse: { animation: `${pulse} 1.6s ease-in-out infinite` },
      shimmer: {
        backgroundImage: `linear-gradient(90deg, ${theme.color.muted} 0%, ${theme.color.border} 50%, ${theme.color.muted} 100%)`,
        backgroundSize: "200% 100%",
        animation: `${shimmer} 1.6s linear infinite`,
      },
      none: {},
    },
  },
  defaultVariants: { shape: "rect", animation: "shimmer" },
});

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  shape?: "text" | "circle" | "rect";
  animation?: "pulse" | "shimmer" | "none";
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  /** Render this many stacked text lines, the last one shortened like real prose. */
  lines?: number;
}

/** A loading placeholder. Use `lines` for multi-line text blocks, `shape="circle"` for avatars. */
export function Skeleton({
  shape = "rect",
  animation = "shimmer",
  width,
  height,
  lines,
  className,
  style,
  ...props
}: SkeletonProps) {
  if (lines && lines > 1) {
    return (
      <span aria-hidden="true" style={{ display: "block", width }} {...props}>
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            className={skeletonVariants({ shape: "text", animation })}
            style={{ width: i === lines - 1 ? "60%" : "100%" }}
          />
        ))}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={skeletonVariants({ shape, animation, className })}
      style={{ width, height, ...style }}
      {...props}
    />
  );
}
