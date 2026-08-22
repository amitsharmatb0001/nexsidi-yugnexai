"use client";

import { css, themeVars as theme } from "@yugnex/core";
import type { HTMLAttributes, ReactNode } from "react";

const rootClass = css({
  display: "flex",
  width: "100%",
  fontFamily: theme.fontFamily.sans,
  '&[data-orientation="vertical"]': { flexDirection: "column", gap: theme.space[1] },
});

const stepClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[2.5],
  minWidth: 0,
  '[data-orientation="horizontal"] > &': { flex: 1 },
  '[data-orientation="vertical"] > &': { alignItems: "flex-start", paddingBottom: theme.space[4] },
});

const markerClass = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  width: "1.75rem",
  height: "1.75rem",
  borderRadius: "9999px",
  border: `2px solid ${theme.color.border}`,
  backgroundColor: theme.color.background,
  color: theme.color.mutedForeground,
  fontSize: theme.fontSize.xs,
  fontWeight: theme.fontWeight.semibold,
  fontVariantNumeric: "tabular-nums",
  transitionProperty: "background-color, border-color, color",
  transitionDuration: theme.duration.base,
  '&[data-state="active"]': {
    borderColor: theme.color.primary,
    color: theme.color.primary,
    boxShadow: `0 0 0 3px ${theme.color.accent}`,
  },
  '&[data-state="complete"]': {
    borderColor: theme.color.primary,
    backgroundColor: theme.color.primary,
    color: theme.color.primaryForeground,
  },
});

const labelWrapClass = css({ minWidth: 0, display: "flex", flexDirection: "column" });

const labelClass = css({
  fontSize: theme.fontSize.sm,
  fontWeight: theme.fontWeight.medium,
  color: theme.color.mutedForeground,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  '[data-state="active"] + & , [data-state="complete"] + &': { color: theme.color.foreground },
});

const descriptionClass = css({
  fontSize: theme.fontSize.xs,
  color: theme.color.mutedForeground,
});

const connectorClass = css({
  flex: 1,
  height: "2px",
  minWidth: theme.space[3],
  borderRadius: "9999px",
  backgroundColor: theme.color.border,
  transitionProperty: "background-color",
  transitionDuration: theme.duration.base,
  '&[data-complete="true"]': { backgroundColor: theme.color.primary },
});

export interface Step {
  label: ReactNode;
  description?: ReactNode;
}

export interface StepperProps extends HTMLAttributes<HTMLDivElement> {
  steps: Step[];
  /** Zero-based index of the active step. Everything before it renders complete. */
  current: number;
  orientation?: "horizontal" | "vertical";
}

/** Progress through a multi-step flow — onboarding, a wizard, a staged agent run. */
export function Stepper({ steps, current, orientation = "horizontal", className, ...props }: StepperProps) {
  return (
    <div
      className={className ? `${rootClass} ${className}` : rootClass}
      data-orientation={orientation}
      aria-label={props["aria-label"] ?? "Progress"}
      {...props}
    >
      {steps.map((step, index) => {
        const state = index < current ? "complete" : index === current ? "active" : "upcoming";
        const isLast = index === steps.length - 1;
        return (
          <div key={index} className={stepClass}>
            <span className={markerClass} data-state={state} aria-current={state === "active" ? "step" : undefined}>
              {state === "complete" ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path
                    d="M3 7.5L5.75 10.25L11 4.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                index + 1
              )}
            </span>
            <span className={labelWrapClass}>
              <span className={labelClass}>{step.label}</span>
              {step.description ? <span className={descriptionClass}>{step.description}</span> : null}
            </span>
            {!isLast && orientation === "horizontal" ? (
              <span className={connectorClass} data-complete={index < current} aria-hidden="true" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
