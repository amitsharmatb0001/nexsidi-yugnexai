"use client";

import { createVariants, css, keyframes, themeVars as theme } from "@yugnex/core";
import {
  cloneElement,
  forwardRef,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactElement,
  type Ref,
} from "react";

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): (node: T | null) => void {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as { current: T | null }).current = node;
    }
  };
}

const spin = keyframes({
  from: { transform: "rotate(0deg)" },
  to: { transform: "rotate(360deg)" },
});

const spinnerClass = css({
  width: "1em",
  height: "1em",
  borderRadius: "9999px",
  border: "2px solid currentColor",
  borderTopColor: "transparent",
  animation: `${spin} 0.6s linear infinite`,
});

const buttonVariants = createVariants({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space[2],
    fontFamily: theme.fontFamily.sans,
    fontWeight: theme.fontWeight.medium,
    borderRadius: theme.radius.md,
    border: "1px solid transparent",
    cursor: "pointer",
    transitionProperty: "background-color, border-color, transform, opacity",
    transitionDuration: theme.duration.fast,
    transitionTimingFunction: theme.easing.standard,
    "&:active": {
      transform: "scale(0.97)",
    },
    "&:focus-visible": {
      outline: `2px solid ${theme.color.ring}`,
      outlineOffset: "2px",
    },
    "&:disabled": {
      opacity: 0.5,
      cursor: "not-allowed",
      transform: "none",
    },
  },
  variants: {
    variant: {
      solid: {
        backgroundColor: theme.color.primary,
        color: theme.color.primaryForeground,
        "&:hover:not(:disabled)": { opacity: 0.92 },
      },
      outline: {
        backgroundColor: "transparent",
        borderColor: theme.color.border,
        color: theme.color.foreground,
        "&:hover:not(:disabled)": { backgroundColor: theme.color.muted },
      },
      ghost: {
        backgroundColor: "transparent",
        color: theme.color.foreground,
        "&:hover:not(:disabled)": { backgroundColor: theme.color.muted },
      },
      soft: {
        backgroundColor: theme.color.accent,
        color: theme.color.accentForeground,
        "&:hover:not(:disabled)": { opacity: 0.85 },
      },
    },
    tone: {
      primary: {},
      destructive: {},
    },
    size: {
      sm: {
        height: "2rem",
        paddingLeft: theme.space[3],
        paddingRight: theme.space[3],
        fontSize: theme.fontSize.sm,
      },
      md: {
        height: "2.5rem",
        paddingLeft: theme.space[4],
        paddingRight: theme.space[4],
        fontSize: theme.fontSize.sm,
      },
      lg: {
        height: "2.75rem",
        paddingLeft: theme.space[5],
        paddingRight: theme.space[5],
        fontSize: theme.fontSize.base,
      },
    },
  },
  compoundVariants: [
    {
      variant: "solid",
      tone: "destructive",
      css: { backgroundColor: theme.color.destructive, color: theme.color.destructiveForeground },
    },
    {
      variant: "outline",
      tone: "destructive",
      css: { borderColor: theme.color.destructive, color: theme.color.destructive },
    },
    {
      variant: "ghost",
      tone: "destructive",
      css: { color: theme.color.destructive },
    },
    {
      variant: "soft",
      tone: "destructive",
      css: { backgroundColor: theme.color.destructive, color: theme.color.destructiveForeground },
    },
  ],
  defaultVariants: {
    variant: "solid",
    tone: "primary",
    size: "md",
  },
});

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "solid" | "outline" | "ghost" | "soft";
  tone?: "primary" | "destructive";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  /** Render the single child element (e.g. a Next.js <Link>) with Button's classes/ref instead of a <button>. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, tone, size, isLoading, disabled, className, children, asChild, ...props },
  ref,
) {
  const classes = buttonVariants({ variant, tone, size, className });

  if (asChild && isValidElement(children)) {
    const element = children as ReactElement<Record<string, unknown>>;
    const childRef = (element as { ref?: Ref<HTMLElement> }).ref;
    const childProps = element.props as { className?: string };
    return cloneElement(element, {
      ...props,
      ref: mergeRefs(ref, childRef),
      className: [classes, childProps.className].filter(Boolean).join(" "),
      "aria-busy": isLoading || undefined,
    });
  }

  return (
    <button
      ref={ref}
      className={classes}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {isLoading ? <span className={spinnerClass} aria-hidden="true" /> : null}
      {children}
    </button>
  );
});
