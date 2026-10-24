"use client";

import { createVariants, css, themeVars as theme } from "@yugnex/core";
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";

const inputVariants = createVariants({
  base: {
    display: "block",
    width: "100%",
    borderRadius: theme.radius.md,
    border: `1px solid ${theme.color.input}`,
    backgroundColor: theme.color.background,
    color: theme.color.foreground,
    fontFamily: theme.fontFamily.sans,
    fontSize: theme.fontSize.sm,
    height: "2.5rem",
    paddingLeft: theme.space[3],
    paddingRight: theme.space[3],
    transitionProperty: "border-color, box-shadow",
    transitionDuration: theme.duration.fast,
    transitionTimingFunction: theme.easing.standard,
    "&::placeholder": { color: theme.color.mutedForeground },
    "&:focus-visible": {
      outline: "none",
      borderColor: theme.color.ring,
      boxShadow: `0 0 0 3px ${theme.color.accent}`,
    },
    "&:disabled": {
      opacity: 0.5,
      cursor: "not-allowed",
    },
  },
  variants: {
    invalid: {
      true: { borderColor: theme.color.destructive },
    },
  },
});

const labelClass = css({
  display: "block",
  marginBottom: theme.space[1.5],
  fontSize: theme.fontSize.sm,
  fontWeight: theme.fontWeight.medium,
  color: theme.color.foreground,
});

const descriptionClass = css({
  marginTop: theme.space[1.5],
  fontSize: theme.fontSize.xs,
  color: theme.color.mutedForeground,
});

const errorClass = css({
  marginTop: theme.space[1.5],
  fontSize: theme.fontSize.xs,
  color: theme.color.destructive,
});

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, description, error, id, className, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      {label ? (
        <label className={labelClass} htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        className={inputVariants({ invalid: error ? "true" : undefined, className })}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {description ? (
        <p id={descriptionId} className={descriptionClass}>
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={errorClass} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
});
