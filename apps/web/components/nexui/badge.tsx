"use client";

import { createVariants, themeVars as theme } from "@yugnex/core";
import { forwardRef, type HTMLAttributes } from "react";

const badgeVariants = createVariants({
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: theme.space[1],
    borderRadius: theme.radius.full,
    fontFamily: theme.fontFamily.sans,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 1,
    border: "1px solid transparent",
    whiteSpace: "nowrap",
  },
  variants: {
    variant: {
      solid: {},
      soft: {},
      outline: { backgroundColor: "transparent" },
    },
    tone: {
      primary: {},
      secondary: {},
      success: {},
      warning: {},
      destructive: {},
    },
    size: {
      sm: {
        fontSize: theme.fontSize.xs,
        paddingLeft: theme.space[2],
        paddingRight: theme.space[2],
        height: "1.25rem",
      },
      md: {
        fontSize: theme.fontSize.sm,
        paddingLeft: theme.space[2.5],
        paddingRight: theme.space[2.5],
        height: "1.5rem",
      },
    },
  },
  compoundVariants: [
    { variant: "solid", tone: "primary", css: { backgroundColor: theme.color.primary, color: theme.color.primaryForeground } },
    { variant: "solid", tone: "secondary", css: { backgroundColor: theme.color.secondary, color: theme.color.secondaryForeground } },
    { variant: "solid", tone: "success", css: { backgroundColor: theme.color.success, color: theme.color.successForeground } },
    { variant: "solid", tone: "warning", css: { backgroundColor: theme.color.warning, color: theme.color.warningForeground } },
    { variant: "solid", tone: "destructive", css: { backgroundColor: theme.color.destructive, color: theme.color.destructiveForeground } },

    { variant: "soft", tone: "primary", css: { backgroundColor: theme.color.accent, color: theme.color.accentForeground } },
    { variant: "soft", tone: "secondary", css: { backgroundColor: theme.color.muted, color: theme.color.mutedForeground } },
    { variant: "soft", tone: "success", css: { backgroundColor: theme.color.muted, color: theme.color.success } },
    { variant: "soft", tone: "warning", css: { backgroundColor: theme.color.muted, color: theme.color.warning } },
    { variant: "soft", tone: "destructive", css: { backgroundColor: theme.color.muted, color: theme.color.destructive } },

    { variant: "outline", tone: "primary", css: { borderColor: theme.color.primary, color: theme.color.primary } },
    { variant: "outline", tone: "secondary", css: { borderColor: theme.color.border, color: theme.color.foreground } },
    { variant: "outline", tone: "success", css: { borderColor: theme.color.success, color: theme.color.success } },
    { variant: "outline", tone: "warning", css: { borderColor: theme.color.warning, color: theme.color.warning } },
    { variant: "outline", tone: "destructive", css: { borderColor: theme.color.destructive, color: theme.color.destructive } },
  ],
  defaultVariants: { variant: "solid", tone: "primary", size: "md" },
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "solid" | "soft" | "outline";
  tone?: "primary" | "secondary" | "success" | "warning" | "destructive";
  size?: "sm" | "md";
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant, tone, size, className, ...props },
  ref,
) {
  return <span ref={ref} className={badgeVariants({ variant, tone, size, className })} {...props} />;
});
