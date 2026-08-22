"use client";

import { createVariants, css, keyframes, themeVars as theme } from "@yugnex/core";
import type { HTMLAttributes } from "react";

const indeterminateSlide = keyframes({
  "0%": { transform: "translateX(-100%)" },
  "100%": { transform: "translateX(400%)" },
});

const trackVariants = createVariants({
  base: {
    position: "relative",
    width: "100%",
    borderRadius: "9999px",
    backgroundColor: theme.color.muted,
    overflow: "hidden",
  },
  variants: {
    size: {
      sm: { height: "4px" },
      md: { height: "8px" },
      lg: { height: "12px" },
    },
  },
  defaultVariants: { size: "md" },
});

const fillVariants = createVariants({
  base: {
    height: "100%",
    borderRadius: "9999px",
    transitionProperty: "width",
    transitionDuration: theme.duration.slow,
    transitionTimingFunction: theme.easing.decelerate,
  },
  variants: {
    tone: {
      primary: { backgroundColor: theme.color.primary },
      success: { backgroundColor: theme.color.success },
      warning: { backgroundColor: theme.color.warning },
      destructive: { backgroundColor: theme.color.destructive },
    },
  },
  defaultVariants: { tone: "primary" },
});

const indeterminateBarClass = css({
  position: "absolute",
  top: 0,
  left: 0,
  height: "100%",
  width: "25%",
  borderRadius: "9999px",
  animation: `${indeterminateSlide} 1.4s ${theme.easing.standard} infinite`,
});

export interface ProgressProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Omit (or pass undefined) for an indeterminate bar. */
  value?: number;
  max?: number;
  size?: "sm" | "md" | "lg";
  tone?: "primary" | "success" | "warning" | "destructive";
  label?: string;
}

/** A progress bar. With no `value` it renders an indeterminate sliding bar. */
export function Progress({
  value,
  max = 100,
  size = "md",
  tone = "primary",
  label,
  className,
  ...props
}: ProgressProps) {
  const indeterminate = value == null;
  const clamped = indeterminate ? 0 : Math.min(Math.max(value, 0), max);
  const percent = indeterminate ? 0 : (clamped / (max || 1)) * 100;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={indeterminate ? undefined : clamped}
      aria-label={label}
      className={trackVariants({ size, className })}
      {...props}
    >
      {indeterminate ? (
        <div
          className={`${fillVariants({ tone })} ${indeterminateBarClass}`}
          style={{ width: "25%" }}
          aria-hidden="true"
        />
      ) : (
        <div className={fillVariants({ tone })} style={{ width: `${percent}%` }} />
      )}
    </div>
  );
}
