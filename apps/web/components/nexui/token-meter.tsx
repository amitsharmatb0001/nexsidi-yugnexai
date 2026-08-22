"use client";

import { css, themeVars as theme } from "@yugnex/core";
import type { HTMLAttributes } from "react";

const rootClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[1.5],
  width: "100%",
  fontFamily: theme.fontFamily.sans,
});

const headerClass = css({
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: theme.space[2],
  fontSize: theme.fontSize.xs,
});

const labelClass = css({ color: theme.color.mutedForeground });

const valueClass = css({
  fontFamily: theme.fontFamily.mono,
  fontVariantNumeric: "tabular-nums",
  color: theme.color.foreground,
});

const trackClass = css({
  position: "relative",
  height: "6px",
  width: "100%",
  borderRadius: "9999px",
  backgroundColor: theme.color.muted,
  overflow: "hidden",
});

const fillClass = css({
  height: "100%",
  borderRadius: "9999px",
  transitionProperty: "width, background-color",
  transitionDuration: theme.duration.slow,
  transitionTimingFunction: theme.easing.decelerate,
});

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`;
  return String(value);
}

export interface TokenMeterProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Tokens consumed so far. */
  used: number;
  /** Total context window / budget. */
  total: number;
  label?: string;
  /** Fraction (0-1) at which the bar turns warning-colored. */
  warnAt?: number;
  /** Fraction (0-1) at which the bar turns destructive-colored. */
  dangerAt?: number;
  /** Render exact numbers instead of compact (1.2k) form. */
  exact?: boolean;
}

/**
 * A context-window budget meter: how much of the model's window a conversation
 * has consumed, shifting from primary to warning to destructive as it fills.
 * Exposed as a real progressbar so the ratio is available to assistive tech.
 */
export function TokenMeter({
  used,
  total,
  label = "Context used",
  warnAt = 0.75,
  dangerAt = 0.9,
  exact = false,
  className,
  ...props
}: TokenMeterProps) {
  const safeTotal = total > 0 ? total : 1;
  const ratio = Math.min(Math.max(used / safeTotal, 0), 1);
  const percent = Math.round(ratio * 100);

  const color =
    ratio >= dangerAt ? theme.color.destructive : ratio >= warnAt ? theme.color.warning : theme.color.primary;

  const format = exact ? (n: number) => n.toLocaleString() : formatCompact;

  return (
    <div className={className ? `${rootClass} ${className}` : rootClass} {...props}>
      <div className={headerClass}>
        <span className={labelClass}>{label}</span>
        <span className={valueClass}>
          {format(used)} / {format(total)} ({percent}%)
        </span>
      </div>
      <div
        className={trackClass}
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={label}
        aria-valuetext={`${percent}% of context used`}
      >
        <div className={fillClass} style={{ width: `${percent}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
