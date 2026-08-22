"use client";

import { createVariants, css, themeVars as theme } from "@yugnex/core";
import type { HTMLAttributes, ReactNode } from "react";

const alertVariants = createVariants({
  base: {
    display: "flex",
    gap: theme.space[3],
    padding: theme.space[4],
    borderRadius: theme.radius.md,
    border: "1px solid transparent",
    fontFamily: theme.fontFamily.sans,
    fontSize: theme.fontSize.sm,
  },
  variants: {
    tone: {
      info: {
        backgroundColor: theme.color.muted,
        borderColor: theme.color.border,
        color: theme.color.foreground,
      },
      success: {
        backgroundColor: theme.color.muted,
        borderColor: theme.color.success,
        color: theme.color.foreground,
      },
      warning: {
        backgroundColor: theme.color.muted,
        borderColor: theme.color.warning,
        color: theme.color.foreground,
      },
      destructive: {
        backgroundColor: theme.color.muted,
        borderColor: theme.color.destructive,
        color: theme.color.foreground,
      },
    },
  },
  defaultVariants: { tone: "info" },
});

const iconClass = css({
  flexShrink: 0,
  width: "1.125rem",
  height: "1.125rem",
  marginTop: "1px",
});

const contentClass = css({ minWidth: 0, flex: 1 });

const titleClass = css({
  margin: 0,
  fontWeight: theme.fontWeight.semibold,
  fontSize: theme.fontSize.sm,
});

const descriptionClass = css({
  margin: `${theme.space[1]} 0 0`,
  color: theme.color.mutedForeground,
  fontSize: theme.fontSize.sm,
  lineHeight: theme.lineHeight.sm,
});

const TONE_COLOR = {
  info: theme.color.mutedForeground,
  success: theme.color.success,
  warning: theme.color.warning,
  destructive: theme.color.destructive,
} as const;

const TONE_PATH = {
  info: "M9 12h.01M9 6v3.5M9 16.5A7.5 7.5 0 1 0 9 1.5a7.5 7.5 0 0 0 0 15Z",
  success: "M5.5 9.5 8 12l4.5-5M9 16.5A7.5 7.5 0 1 0 9 1.5a7.5 7.5 0 0 0 0 15Z",
  warning: "M9 6.5v3.5M9 13h.01M7.7 2.3 1.3 13.2A1.5 1.5 0 0 0 2.6 15.5h12.8a1.5 1.5 0 0 0 1.3-2.3L10.3 2.3a1.5 1.5 0 0 0-2.6 0Z",
  destructive: "M11.5 6.5l-5 5M6.5 6.5l5 5M9 16.5A7.5 7.5 0 1 0 9 1.5a7.5 7.5 0 0 0 0 15Z",
} as const;

// `title` is omitted from the native attributes so it can be a ReactNode here
// rather than the string the HTML tooltip attribute expects.
export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: "info" | "success" | "warning" | "destructive";
  title?: ReactNode;
  /** Replace the built-in tone icon. Pass `null` to remove it. */
  icon?: ReactNode;
  /** Trailing slot, e.g. a dismiss button. */
  action?: ReactNode;
}

/** A callout for status, validation, or system messages. Destructive alerts announce assertively. */
export function Alert({ tone = "info", title, icon, action, className, children, ...props }: AlertProps) {
  return (
    <div
      role="alert"
      aria-live={tone === "destructive" ? "assertive" : "polite"}
      className={alertVariants({ tone, className })}
      {...props}
    >
      {icon === null ? null : (
        icon ?? (
          <svg
            className={iconClass}
            viewBox="0 0 18 18"
            fill="none"
            aria-hidden="true"
            style={{ color: TONE_COLOR[tone] }}
          >
            <path
              d={TONE_PATH[tone]}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )
      )}
      <div className={contentClass}>
        {title ? <p className={titleClass}>{title}</p> : null}
        {children ? <div className={descriptionClass}>{children}</div> : null}
      </div>
      {action}
    </div>
  );
}
