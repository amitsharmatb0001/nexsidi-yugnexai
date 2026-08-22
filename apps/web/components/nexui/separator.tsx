"use client";

import { css, themeVars as theme } from "@yugnex/core";
import type { HTMLAttributes, ReactNode } from "react";

const horizontalClass = css({
  border: "none",
  height: "1px",
  width: "100%",
  margin: 0,
  backgroundColor: theme.color.border,
  flexShrink: 0,
});

const verticalClass = css({
  border: "none",
  width: "1px",
  alignSelf: "stretch",
  minHeight: "1em",
  margin: 0,
  backgroundColor: theme.color.border,
  flexShrink: 0,
});

const labelledClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[3],
  width: "100%",
  color: theme.color.mutedForeground,
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.xs,
  "&::before, &::after": {
    content: '""',
    flex: 1,
    height: "1px",
    backgroundColor: theme.color.border,
  },
});

export interface SeparatorProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
  /** Optional centered label; renders rules on both sides of it. */
  children?: ReactNode;
  /** Purely visual separators are hidden from assistive tech (the default). */
  decorative?: boolean;
}

/** A dividing rule. Pass children to render a centered label between two rules. */
export function Separator({
  orientation = "horizontal",
  decorative = true,
  children,
  className,
  ...props
}: SeparatorProps) {
  const a11y = decorative
    ? ({ role: "none" } as const)
    : ({ role: "separator", "aria-orientation": orientation } as const);

  if (children) {
    return (
      <div className={className ? `${labelledClass} ${className}` : labelledClass} {...a11y} {...props}>
        {children}
      </div>
    );
  }

  const base = orientation === "vertical" ? verticalClass : horizontalClass;
  return <div className={className ? `${base} ${className}` : base} {...a11y} {...props} />;
}
