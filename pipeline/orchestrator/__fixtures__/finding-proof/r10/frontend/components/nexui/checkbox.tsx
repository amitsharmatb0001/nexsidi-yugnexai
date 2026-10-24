"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { useControllableState } from "@yugnex/core/client";
import { forwardRef, useEffect, useRef, type InputHTMLAttributes } from "react";

type CheckedState = boolean | "indeterminate";

const boxClass = css({
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1.125rem",
  height: "1.125rem",
  borderRadius: theme.radius.sm,
  border: `1px solid ${theme.color.input}`,
  backgroundColor: theme.color.background,
  cursor: "pointer",
  flexShrink: 0,
  transitionProperty: "background-color, border-color",
  transitionDuration: theme.duration.fast,
  transitionTimingFunction: theme.easing.standard,
  '&[data-state="checked"], &[data-state="indeterminate"]': {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  "&:has(:focus-visible)": {
    outline: `2px solid ${theme.color.ring}`,
    outlineOffset: "2px",
  },
  '&[data-disabled="true"]': {
    opacity: 0.5,
    cursor: "not-allowed",
  },
});

const inputClass = css({
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  margin: 0,
  opacity: 0,
});

const iconClass = css({
  color: "#ffffff",
  width: "0.75rem",
  height: "0.75rem",
});

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "checked" | "defaultChecked" | "onChange" | "type"> {
  checked?: CheckedState;
  defaultChecked?: CheckedState;
  onCheckedChange?: (checked: CheckedState) => void;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { checked, defaultChecked = false, onCheckedChange, className, disabled, id, ...props },
  ref,
) {
  const [state, setState] = useControllableState<CheckedState>({
    value: checked,
    defaultValue: defaultChecked,
    onChange: onCheckedChange,
  });

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = state === "indeterminate";
  }, [state]);

  const dataState = state === "indeterminate" ? "indeterminate" : state ? "checked" : "unchecked";

  return (
    <span
      className={className ? `${boxClass} ${className}` : boxClass}
      data-state={dataState}
      data-disabled={disabled ? "true" : undefined}
    >
      <input
        ref={(node) => {
          inputRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        id={id}
        type="checkbox"
        className={inputClass}
        checked={state === true}
        disabled={disabled}
        onChange={(event) => setState(event.target.checked)}
        {...props}
      />
      {state === "indeterminate" ? (
        <svg viewBox="0 0 12 12" className={iconClass} fill="none" aria-hidden="true">
          <path d="M2.5 6H9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : state ? (
        <svg viewBox="0 0 12 12" className={iconClass} fill="none" aria-hidden="true">
          <path
            d="M2.5 6.5L4.75 8.75L9.5 3.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  );
});
