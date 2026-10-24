"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { useControllableState } from "@yugnex/core/client";
import { forwardRef, type ButtonHTMLAttributes } from "react";

const trackClass = css({
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  width: "2.5rem",
  height: "1.5rem",
  borderRadius: theme.radius.full,
  backgroundColor: theme.color.input,
  border: "none",
  padding: "2px",
  cursor: "pointer",
  flexShrink: 0,
  transitionProperty: "background-color",
  transitionDuration: theme.duration.fast,
  transitionTimingFunction: theme.easing.standard,
  '&[data-state="checked"]': {
    backgroundColor: theme.color.primary,
  },
  "&:focus-visible": {
    outline: `2px solid ${theme.color.ring}`,
    outlineOffset: "2px",
  },
  "&:disabled": {
    opacity: 0.5,
    cursor: "not-allowed",
  },
});

const thumbClass = css({
  width: "1.125rem",
  height: "1.125rem",
  borderRadius: theme.radius.full,
  backgroundColor: "#ffffff",
  boxShadow: theme.shadow.sm,
  transform: "translateX(0)",
  transitionProperty: "transform",
  transitionDuration: theme.duration.fast,
  transitionTimingFunction: theme.easing.standard,
  '[data-state="checked"] &': {
    transform: "translateX(1rem)",
  },
});

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, defaultChecked = false, onCheckedChange, className, disabled, ...props },
  ref,
) {
  const [isChecked, setChecked] = useControllableState({
    value: checked,
    defaultValue: defaultChecked,
    onChange: onCheckedChange,
  });

  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={isChecked}
      data-state={isChecked ? "checked" : "unchecked"}
      disabled={disabled}
      className={className ? `${trackClass} ${className}` : trackClass}
      onClick={() => setChecked(!isChecked)}
      {...props}
    >
      <span className={thumbClass} />
    </button>
  );
});
