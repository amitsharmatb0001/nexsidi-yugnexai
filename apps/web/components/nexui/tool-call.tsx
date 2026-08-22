"use client";

import { createVariants, css, keyframes, themeVars as theme } from "@yugnex/core";
import { useControllableState } from "@yugnex/core/client";
import { useId, type ReactNode } from "react";

export type ToolCallStatus = "pending" | "running" | "success" | "error";

const spin = keyframes({ from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } });

const rootVariants = createVariants({
  base: {
    borderRadius: theme.radius.md,
    border: `1px solid ${theme.color.border}`,
    backgroundColor: theme.color.card,
    overflow: "hidden",
    fontFamily: theme.fontFamily.sans,
  },
  variants: {
    status: {
      pending: {},
      running: { borderColor: theme.color.primary },
      success: {},
      error: { borderColor: theme.color.destructive },
    },
  },
  defaultVariants: { status: "pending" },
});

const triggerClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[2],
  width: "100%",
  padding: `${theme.space[2.5]} ${theme.space[3]}`,
  border: "none",
  background: "transparent",
  color: theme.color.foreground,
  cursor: "pointer",
  textAlign: "left",
  fontSize: theme.fontSize.sm,
  transitionProperty: "background-color",
  transitionDuration: theme.duration.fast,
  "&:hover": { backgroundColor: theme.color.muted },
  "&:focus-visible": { outline: `2px solid ${theme.color.ring}`, outlineOffset: "-2px" },
});

const nameClass = css({
  fontFamily: theme.fontFamily.mono,
  fontSize: theme.fontSize.xs,
  fontWeight: theme.fontWeight.medium,
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const chevronClass = css({
  flexShrink: 0,
  transitionProperty: "transform",
  transitionDuration: theme.duration.fast,
  transitionTimingFunction: theme.easing.standard,
  '[data-state="open"] &': { transform: "rotate(90deg)" },
});

const bodyClass = css({
  borderTop: `1px solid ${theme.color.border}`,
  padding: theme.space[3],
  display: "flex",
  flexDirection: "column",
  gap: theme.space[3],
});

const sectionLabelClass = css({
  fontSize: theme.fontSize.xs,
  fontWeight: theme.fontWeight.semibold,
  letterSpacing: theme.letterSpacing.wide,
  textTransform: "uppercase",
  color: theme.color.mutedForeground,
  marginBottom: theme.space[1],
});

const preClass = css({
  margin: 0,
  padding: theme.space[2.5],
  borderRadius: theme.radius.sm,
  backgroundColor: theme.color.muted,
  fontFamily: theme.fontFamily.mono,
  fontSize: theme.fontSize.xs,
  lineHeight: theme.lineHeight.sm,
  overflowX: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  color: theme.color.foreground,
});

const errorPreClass = css({ color: theme.color.destructive });

const statusDotClass = css({
  width: "8px",
  height: "8px",
  borderRadius: "9999px",
  flexShrink: 0,
});

const spinnerClass = css({
  width: "10px",
  height: "10px",
  flexShrink: 0,
  borderRadius: "9999px",
  border: `2px solid ${theme.color.primary}`,
  borderTopColor: "transparent",
  animation: `${spin} 0.7s linear infinite`,
});

const STATUS_COLOR: Record<ToolCallStatus, string> = {
  pending: theme.color.mutedForeground,
  running: theme.color.primary,
  success: theme.color.success,
  error: theme.color.destructive,
};

const STATUS_LABEL: Record<ToolCallStatus, string> = {
  pending: "Queued",
  running: "Running",
  success: "Completed",
  error: "Failed",
};

function formatPayload(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export interface ToolCallProps {
  /** The tool/function name, e.g. "search_docs". */
  name: string;
  status?: ToolCallStatus;
  /** Arguments the model passed. Objects are pretty-printed as JSON. */
  args?: unknown;
  /** What the tool returned. Objects are pretty-printed as JSON. */
  result?: unknown;
  /** Error text, shown in place of the result when status is "error". */
  error?: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Extra content rendered at the bottom of the expanded body. */
  children?: ReactNode;
  className?: string;
}

/**
 * A collapsible record of one tool/function invocation by an agent — name,
 * live status, the arguments it was called with, and what it returned. This is
 * the thing you need to make an agent's reasoning legible instead of a black box.
 */
export function ToolCall({
  name,
  status = "pending",
  args,
  result,
  error,
  open,
  defaultOpen = false,
  onOpenChange,
  children,
  className,
}: ToolCallProps) {
  const [isOpen, setOpen] = useControllableState({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  const bodyId = useId();

  const argsText = formatPayload(args);
  const resultText = error ?? formatPayload(result);
  const hasBody = Boolean(argsText || resultText || children);

  return (
    <div className={rootVariants({ status, className })} data-state={isOpen ? "open" : "closed"}>
      <button
        type="button"
        className={triggerClass}
        aria-expanded={isOpen}
        aria-controls={hasBody ? bodyId : undefined}
        onClick={() => hasBody && setOpen(!isOpen)}
      >
        {status === "running" ? (
          <span className={spinnerClass} aria-hidden="true" />
        ) : (
          <span
            className={statusDotClass}
            style={{ backgroundColor: STATUS_COLOR[status] }}
            aria-hidden="true"
          />
        )}
        <span className={nameClass}>{name}</span>
        <span style={{ fontSize: "0.75rem", color: STATUS_COLOR[status] }}>{STATUS_LABEL[status]}</span>
        {hasBody ? (
          <svg
            className={chevronClass}
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
          >
            <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : null}
      </button>

      {isOpen && hasBody ? (
        <div className={bodyClass} id={bodyId}>
          {argsText ? (
            <div>
              <p className={sectionLabelClass}>Arguments</p>
              <pre className={preClass}>{argsText}</pre>
            </div>
          ) : null}
          {resultText ? (
            <div>
              <p className={sectionLabelClass}>{error ? "Error" : "Result"}</p>
              <pre className={error ? `${preClass} ${errorPreClass}` : preClass}>{resultText}</pre>
            </div>
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}
