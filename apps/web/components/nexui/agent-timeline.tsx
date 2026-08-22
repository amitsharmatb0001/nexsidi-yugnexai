"use client";

import { css, keyframes, themeVars as theme } from "@yugnex/core";
import type { HTMLAttributes, ReactNode } from "react";

export type AgentStepStatus = "pending" | "running" | "success" | "error" | "skipped";

const spin = keyframes({ from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } });
const pulse = keyframes({
  "0%, 100%": { boxShadow: `0 0 0 0 ${theme.color.accent}` },
  "50%": { boxShadow: `0 0 0 4px ${theme.color.accent}` },
});

const listClass = css({
  display: "flex",
  flexDirection: "column",
  margin: 0,
  padding: 0,
  listStyle: "none",
  fontFamily: theme.fontFamily.sans,
});

const stepClass = css({
  position: "relative",
  display: "grid",
  gridTemplateColumns: "1.5rem 1fr",
  gap: theme.space[3],
  paddingBottom: theme.space[4],
  // The rail is drawn as a pseudo-element on each step rather than one
  // absolutely-positioned line, so it automatically spans exactly the rendered
  // steps — no measuring, and it can't overshoot past the last marker.
  "&:not(:last-child)::before": {
    content: '""',
    position: "absolute",
    left: "0.6875rem",
    top: "1.5rem",
    bottom: 0,
    width: "1px",
    backgroundColor: theme.color.border,
  },
  "&:last-child": { paddingBottom: 0 },
});

const markerClass = css({
  position: "relative",
  zIndex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1.5rem",
  height: "1.5rem",
  borderRadius: "9999px",
  border: `2px solid ${theme.color.border}`,
  backgroundColor: theme.color.background,
  flexShrink: 0,
  '&[data-status="running"]': {
    borderColor: theme.color.primary,
    animation: `${pulse} 1.8s ease-in-out infinite`,
  },
  '&[data-status="success"]': { borderColor: theme.color.success, backgroundColor: theme.color.success },
  '&[data-status="error"]': { borderColor: theme.color.destructive, backgroundColor: theme.color.destructive },
  '&[data-status="skipped"]': { opacity: 0.5 },
});

const spinnerClass = css({
  width: "10px",
  height: "10px",
  borderRadius: "9999px",
  border: `2px solid ${theme.color.primary}`,
  borderTopColor: "transparent",
  animation: `${spin} 0.7s linear infinite`,
});

const dotClass = css({
  width: "6px",
  height: "6px",
  borderRadius: "9999px",
  backgroundColor: theme.color.mutedForeground,
});

const bodyClass = css({ minWidth: 0, paddingTop: "1px" });

const headerRowClass = css({
  display: "flex",
  alignItems: "baseline",
  gap: theme.space[2],
  flexWrap: "wrap",
});

const titleClass = css({
  margin: 0,
  fontSize: theme.fontSize.sm,
  fontWeight: theme.fontWeight.medium,
  color: theme.color.foreground,
  '[data-status="skipped"] &': { color: theme.color.mutedForeground, textDecoration: "line-through" },
});

const metaClass = css({
  fontSize: theme.fontSize.xs,
  color: theme.color.mutedForeground,
  fontVariantNumeric: "tabular-nums",
});

const detailClass = css({
  marginTop: theme.space[1.5],
  fontSize: theme.fontSize.sm,
  lineHeight: theme.lineHeight.sm,
  color: theme.color.mutedForeground,
});

export interface AgentStep {
  id: string;
  title: ReactNode;
  status?: AgentStepStatus;
  /** Duration, timestamp, token count — anything short and right-aligned to the title. */
  meta?: ReactNode;
  /** Expanded content: reasoning, a <ToolCall>, output, an error. */
  detail?: ReactNode;
}

export interface AgentTimelineProps extends HTMLAttributes<HTMLOListElement> {
  steps: AgentStep[];
}

/**
 * A vertical trace of an agent run — plan, tool calls, observations, answer —
 * with a status marker per step and a rail connecting them. This is what turns
 * "the agent did something for 40 seconds" into a reviewable record.
 */
export function AgentTimeline({ steps, className, ...props }: AgentTimelineProps) {
  return (
    <ol className={className ? `${listClass} ${className}` : listClass} {...props}>
      {steps.map((step) => {
        const status = step.status ?? "pending";
        return (
          <li key={step.id} className={stepClass} data-status={status}>
            <span className={markerClass} data-status={status} aria-hidden="true">
              {status === "running" ? (
                <span className={spinnerClass} />
              ) : status === "success" ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M2.5 6.5L4.75 8.75L9.5 3.5"
                    stroke={theme.color.successForeground}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : status === "error" ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M3.5 3.5L8.5 8.5M8.5 3.5L3.5 8.5"
                    stroke={theme.color.destructiveForeground}
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <span className={dotClass} />
              )}
            </span>
            <div className={bodyClass}>
              <div className={headerRowClass}>
                <p className={titleClass}>{step.title}</p>
                {step.meta ? <span className={metaClass}>{step.meta}</span> : null}
                <span
                  style={{
                    position: "absolute",
                    width: 1,
                    height: 1,
                    overflow: "hidden",
                    clip: "rect(0,0,0,0)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {status}
                </span>
              </div>
              {step.detail ? <div className={detailClass}>{step.detail}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
