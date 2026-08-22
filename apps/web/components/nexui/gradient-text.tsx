"use client";

import { css, themeVars as theme, tokens } from "@yugnex/core";
import { forwardRef, type ElementType, type HTMLAttributes } from "react";

const gradientTextClass = css({
  backgroundClip: "text",
  WebkitBackgroundClip: "text",
  color: "transparent",
  display: "inline-block",
});

const DEFAULT_COLORS = [theme.color.primary, tokens.colorPrimitives.warning[400], tokens.colorPrimitives.success[400]];

export interface GradientTextProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  /** CSS color values (hex, var(), etc.) used as gradient stops. Defaults to the theme's primary/warning/success hues. */
  colors?: string[];
  /** Gradient angle in degrees. */
  angle?: number;
}

/** Renders children with a gradient clipped to the text. Colors/angle are runtime props, not baked into a static class. */
export const GradientText = forwardRef<HTMLElement, GradientTextProps>(function GradientText(
  { as, colors = DEFAULT_COLORS, angle = 120, className, style, ...props },
  ref,
) {
  const Component = as ?? "span";
  const backgroundImage = `linear-gradient(${angle}deg, ${colors.join(", ")})`;

  return (
    <Component
      ref={ref}
      className={className ? `${gradientTextClass} ${className}` : gradientTextClass}
      style={{ backgroundImage, ...style }}
      {...props}
    />
  );
});
