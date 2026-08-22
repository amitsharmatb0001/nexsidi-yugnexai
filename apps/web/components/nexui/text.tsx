"use client";

import { createVariants, themeVars as theme } from "@yugnex/core";
import { forwardRef, type ElementType, type HTMLAttributes, type ReactNode } from "react";

const textVariants = createVariants({
  base: {
    fontFamily: theme.fontFamily.sans,
    margin: 0,
  },
  variants: {
    size: {
      xs: { fontSize: theme.fontSize.xs, lineHeight: theme.lineHeight.xs },
      sm: { fontSize: theme.fontSize.sm, lineHeight: theme.lineHeight.sm },
      base: { fontSize: theme.fontSize.base, lineHeight: theme.lineHeight.base },
      lg: { fontSize: theme.fontSize.lg, lineHeight: theme.lineHeight.lg },
      xl: { fontSize: theme.fontSize.xl, lineHeight: theme.lineHeight.xl },
    },
    weight: {
      regular: { fontWeight: theme.fontWeight.regular },
      medium: { fontWeight: theme.fontWeight.medium },
      semibold: { fontWeight: theme.fontWeight.semibold },
      bold: { fontWeight: theme.fontWeight.bold },
    },
    tone: {
      default: { color: theme.color.foreground },
      muted: { color: theme.color.mutedForeground },
      primary: { color: theme.color.primary },
      destructive: { color: theme.color.destructive },
    },
  },
  defaultVariants: { size: "base", weight: "regular", tone: "default" },
});

export interface TextProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  size?: "xs" | "sm" | "base" | "lg" | "xl";
  weight?: "regular" | "medium" | "semibold" | "bold";
  tone?: "default" | "muted" | "primary" | "destructive";
  children?: ReactNode;
}

/** Sane default typography without hand-writing styles. `as` swaps the rendered tag (p, span, label, ...). */
export const Text = forwardRef<HTMLElement, TextProps>(function Text(
  { as, size, weight, tone, className, ...props },
  ref,
) {
  const Component = as ?? "p";
  return <Component ref={ref} className={textVariants({ size, weight, tone, className })} {...props} />;
});
