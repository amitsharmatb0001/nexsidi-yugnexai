"use client";

import { createVariants, css, themeVars as theme } from "@yugnex/core";
import { forwardRef, useId, type ReactNode, type TextareaHTMLAttributes } from "react";

const textareaVariants = createVariants({
  base: {
    display: "block",
    width: "100%",
    minHeight: "5rem",
    borderRadius: theme.radius.md,
    border: `1px solid ${theme.color.input}`,
    backgroundColor: theme.color.background,
    color: theme.color.foreground,
    fontFamily: theme.fontFamily.sans,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.lineHeight.base,
    padding: `${theme.space[2]} ${theme.space[3]}`,
    resize: "vertical",
    transitionProperty: "border-color, box-shadow",
    transitionDuration: theme.duration.fast,
    transitionTimingFunction: theme.easing.standard,
    "&::placeholder": { color: theme.color.mutedForeground },
    "&:focus-visible": {
      outline: "none",
      borderColor: theme.color.ring,
      boxShadow: `0 0 0 3px ${theme.color.accent}`,
    },
    "&:disabled": { opacity: 0.5, cursor: "not-allowed", resize: "none" },
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

const helpClass = css({
  marginTop: theme.space[1.5],
  fontSize: theme.fontSize.xs,
  color: theme.color.mutedForeground,
});

const errorClass = css({
  marginTop: theme.space[1.5],
  fontSize: theme.fontSize.xs,
  color: theme.color.destructive,
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
}

/** A multiline text field with label, description, and error states wired up for accessibility. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, description, error, id, className, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const descriptionId = description ? `${fieldId}-description` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      {label ? (
        <label className={labelClass} htmlFor={fieldId}>
          {label}
        </label>
      ) : null}
      <textarea
        ref={ref}
        id={fieldId}
        className={textareaVariants({ invalid: error ? "true" : undefined, className })}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {description ? (
        <p id={descriptionId} className={helpClass}>
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
