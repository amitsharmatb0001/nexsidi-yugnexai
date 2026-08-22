"use client";

import { createVariants, themeVars as theme } from "@yugnex/core";
import { forwardRef, type HTMLAttributes } from "react";

const headingVariants = createVariants({
  base: {
    fontFamily: theme.fontFamily.sans,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: theme.letterSpacing.tight,
    margin: 0,
  },
  variants: {
    size: {
      sm: { fontSize: theme.fontSize.lg, lineHeight: theme.lineHeight.lg },
      md: { fontSize: theme.fontSize["2xl"], lineHeight: theme.lineHeight["2xl"] },
      lg: { fontSize: theme.fontSize["3xl"], lineHeight: theme.lineHeight["3xl"] },
      xl: { fontSize: theme.fontSize["4xl"], lineHeight: theme.lineHeight["4xl"] },
      "2xl": { fontSize: theme.fontSize["5xl"], lineHeight: theme.lineHeight["5xl"] },
    },
  },
  defaultVariants: { size: "md" },
});

export interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
}

/** Sane default heading typography. `as` picks the semantic level; `size` picks the visual scale — independently. */
export const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(function Heading(
  { as, size, className, ...props },
  ref,
) {
  const Component = as ?? "h2";
  return <Component ref={ref} className={headingVariants({ size, className })} {...props} />;
});
