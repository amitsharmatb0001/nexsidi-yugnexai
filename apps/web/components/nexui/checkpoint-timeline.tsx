"use client";

import { css, keyframes, themeVars as theme } from "@yugnex/core";
import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/* ------------------------------------------------------------------ *
 * Model
 * ------------------------------------------------------------------ */

export type CheckpointKind = "edit" | "command" | "plan" | "review" | "error" | "start";

export interface Checkpoint {
  id: string;
  label: string;
  kind?: CheckpointKind;
  /** Epoch milliseconds. Drives the elapsed-time readout. */
  at?: number;
  /** Files touched at this point, shown in the detail line. */
  files?: number;
  additions?: number;
  deletions?: number;
  /** Blocks rewinding to this checkpoint. */
  disabled?: boolean;
  detail?: ReactNode;
}

/* ------------------------------------------------------------------ *
 * Time formatting
 * ------------------------------------------------------------------ */

/** Formats a gap between checkpoints — the useful axis here, not wall clock. */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/* ------------------------------------------------------------------ *
 * Styles
 * ------------------------------------------------------------------ */

const pulse = keyframes({
  "0%, 100%": { transform: "scale(1)", opacity: 1 },
  "50%": { transform: "scale(1.35)", opacity: 0.55 },
});

const rootClass = css({
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.sm,
  color: theme.color.foreground,
  border: `1px solid ${theme.color.border}`,
  borderRadius: theme.radius.md,
  backgroundColor: theme.color.card,
  padding: theme.space[3],
});

const trackWrapClass = css({
  position: "relative",
  display: "flex",
  alignItems: "center",
  padding: `${theme.space[4]} ${theme.space[1]} ${theme.space[2]}`,
  overflowX: "auto",
  // Focus lives on the individual nodes; the strip itself must not steal it.
  outline: "none",
});

const trackClass = css({
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: 0,
  minWidth: "100%",
});

const railClass = css({
  position: "absolute",
  left: 0,
  right: 0,
  top: "50%",
  height: "2px",
  transform: "translateY(-50%)",
  backgroundColor: theme.color.border,
  borderRadius: "9999px",
});

/**
 * The rail is drawn twice: a full-width base and a coloured overlay clipped to
 * the current position. Colouring segment-by-segment instead would leave a
 * visible seam at every node.
 */
const railDoneClass = css({
  position: "absolute",
  left: 0,
  top: "50%",
  height: "2px",
  transform: "translateY(-50%)",
  backgroundColor: theme.color.primary,
  borderRadius: "9999px",
  transitionProperty: "width",
  transitionDuration: theme.duration.base,
  transitionTimingFunction: theme.easing.standard,
});

const nodeWrapClass = css({
  position: "relative",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  flex: 1,
  minWidth: "3.5rem",
});

const nodeClass = css({
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1.5rem",
  height: "1.5rem",
  padding: 0,
  borderRadius: "9999px",
  border: `2px solid ${theme.color.border}`,
  backgroundColor: theme.color.card,
  color: theme.color.mutedForeground,
  cursor: "pointer",
  flexShrink: 0,
  transitionProperty: "border-color, background-color, color, transform",
  transitionDuration: theme.duration.fast,
  "&:hover:not(:disabled)": { transform: "scale(1.12)", borderColor: theme.color.primary },
  "&:focus-visible": { outline: `2px solid ${theme.color.ring}`, outlineOffset: "2px" },
  "&:disabled": { opacity: 0.4, cursor: "not-allowed" },
  '&[data-state="past"]': {
    borderColor: theme.color.primary,
    backgroundColor: theme.color.primary,
    color: theme.color.primaryForeground,
  },
  '&[data-state="current"]': {
    borderColor: theme.color.primary,
    backgroundColor: theme.color.card,
    color: theme.color.primary,
    boxShadow: `0 0 0 3px ${theme.color.accent}`,
  },
});

const currentRingClass = css({
  position: "absolute",
  inset: "-4px",
  borderRadius: "9999px",
  border: `2px solid ${theme.color.primary}`,
  animation: `${pulse} 1.8s ${theme.easing.standard} infinite`,
  pointerEvents: "none",
});

const nodeLabelClass = css({
  marginTop: theme.space[1.5],
  maxWidth: "6rem",
  fontSize: "0.6875rem",
  color: theme.color.mutedForeground,
  textAlign: "center",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  '[data-state="current"] ~ &': { color: theme.color.foreground, fontWeight: theme.fontWeight.medium },
});

const detailClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[3],
  marginTop: theme.space[2],
  paddingTop: theme.space[3],
  borderTop: `1px solid ${theme.color.border}`,
  flexWrap: "wrap",
});

const detailTitleClass = css({ fontWeight: theme.fontWeight.medium, fontSize: theme.fontSize.sm });

const detailMetaClass = css({
  display: "inline-flex",
  gap: theme.space[2],
  fontFamily: theme.fontFamily.mono,
  fontSize: theme.fontSize.xs,
  color: theme.color.mutedForeground,
  fontVariantNumeric: "tabular-nums",
});

const addTextClass = css({ color: theme.color.success });
const delTextClass = css({ color: theme.color.destructive });

const rewindButtonClass = css({
  display: "inline-flex",
  alignItems: "center",
  gap: theme.space[1],
  marginLeft: "auto",
  height: "1.875rem",
  padding: `0 ${theme.space[2.5]}`,
  borderRadius: theme.radius.sm,
  border: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.background,
  color: theme.color.foreground,
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.xs,
  fontWeight: theme.fontWeight.medium,
  cursor: "pointer",
  transitionProperty: "background-color, border-color, color",
  transitionDuration: theme.duration.fast,
  "&:hover:not(:disabled)": { borderColor: theme.color.warning, color: theme.color.warning },
  "&:focus-visible": { outline: `2px solid ${theme.color.ring}`, outlineOffset: "1px" },
  "&:disabled": { opacity: 0.5, cursor: "not-allowed" },
});

const confirmClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[2],
  marginLeft: "auto",
  flexWrap: "wrap",
});

const confirmTextClass = css({ fontSize: theme.fontSize.xs, color: theme.color.warning });

const dangerButtonClass = css({
  height: "1.875rem",
  padding: `0 ${theme.space[2.5]}`,
  borderRadius: theme.radius.sm,
  border: `1px solid ${theme.color.destructive}`,
  backgroundColor: theme.color.destructive,
  color: theme.color.destructiveForeground,
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.xs,
  fontWeight: theme.fontWeight.medium,
  cursor: "pointer",
  "&:hover": { opacity: 0.92 },
  "&:focus-visible": { outline: `2px solid ${theme.color.ring}`, outlineOffset: "1px" },
});

const cancelButtonClass = css({
  height: "1.875rem",
  padding: `0 ${theme.space[2.5]}`,
  borderRadius: theme.radius.sm,
  border: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.background,
  color: theme.color.foreground,
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.xs,
  cursor: "pointer",
  "&:focus-visible": { outline: `2px solid ${theme.color.ring}`, outlineOffset: "1px" },
});

const emptyClass = css({
  padding: theme.space[4],
  textAlign: "center",
  color: theme.color.mutedForeground,
  fontSize: theme.fontSize.sm,
});

const KIND_GLYPH: Record<CheckpointKind, string> = {
  start: "M6 4l5 4-5 4V4z",
  edit: "M10.5 2.5l3 3-7 7-3.5.5.5-3.5 7-7z",
  command: "M3.5 5l2.5 2.5L3.5 10M8 10.5h4.5",
  plan: "M3.5 4h9M3.5 8h9M3.5 12h5",
  review: "M3 8.5l3 3 7-7",
  error: "M8 4.5v4M8 11h.01M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13z",
};

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export interface CheckpointTimelineProps {
  checkpoints: Checkpoint[];
  /** Id of the checkpoint the session is currently at. Defaults to the last. */
  current?: string;
  /** Fires when a checkpoint is inspected — selection only, non-destructive. */
  onInspect?: (id: string) => void;
  /**
   * Fires after the user confirms a rewind. Supplying this enables the rewind
   * affordance; omitting it makes the timeline read-only.
   */
  onRewind?: (id: string) => void;
  label?: string;
  className?: string;
}

/**
 * A scrubber over an agent session's checkpoints.
 *
 * Inspecting is separate from rewinding, and rewinding asks first. Moving the
 * selection has to be free — that is the whole point of a scrubber — while the
 * step that actually discards work is the one thing here that cannot be
 * undone, so it gets an explicit confirm rather than firing on click.
 */
export function CheckpointTimeline({
  checkpoints,
  current,
  onInspect,
  onRewind,
  label = "Session checkpoints",
  className,
}: CheckpointTimelineProps) {
  const currentIndex = useMemo(() => {
    if (current) {
      const found = checkpoints.findIndex((c) => c.id === current);
      if (found !== -1) return found;
    }
    return checkpoints.length - 1;
  }, [checkpoints, current]);

  const [inspectedIndex, setInspectedIndex] = useState(currentIndex);
  const [confirming, setConfirming] = useState(false);
  const nodeRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Clamp against a shrinking list rather than reading past the end.
  const safeIndex = Math.min(Math.max(inspectedIndex, 0), Math.max(checkpoints.length - 1, 0));
  const inspected = checkpoints[safeIndex];

  const select = useCallback(
    (index: number) => {
      const clamped = Math.min(Math.max(index, 0), checkpoints.length - 1);
      setInspectedIndex(clamped);
      // Any move invalidates a pending confirm — otherwise the user could aim
      // at one checkpoint, move, and confirm a rewind to a different one.
      setConfirming(false);
      nodeRefs.current[clamped]?.focus();
      const target = checkpoints[clamped];
      if (target) onInspect?.(target.id);
    },
    [checkpoints, onInspect],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        select(index + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        select(index - 1);
        break;
      case "Home":
        event.preventDefault();
        select(0);
        break;
      case "End":
        event.preventDefault();
        select(checkpoints.length - 1);
        break;
      default:
        break;
    }
  };

  if (checkpoints.length === 0) {
    return (
      <div className={className ? `${rootClass} ${className}` : rootClass} aria-label={label}>
        <div className={emptyClass}>No checkpoints yet.</div>
      </div>
    );
  }

  const first = checkpoints[0];
  const elapsed =
    inspected?.at !== undefined && first?.at !== undefined ? formatElapsed(inspected.at - first.at) : undefined;

  // The done-rail spans node centres, and nodes are evenly distributed, so the
  // centre of node i sits at (i + 0.5) / n of the track.
  const donePercent =
    checkpoints.length > 1 ? ((safeIndex + 0.5) / checkpoints.length) * 100 : 50;

  const canRewind = Boolean(onRewind) && safeIndex < currentIndex && !inspected?.disabled;

  return (
    <div className={className ? `${rootClass} ${className}` : rootClass}>
      <div className={trackWrapClass}>
        <div className={trackClass} role="group" aria-label={label}>
          <span className={railClass} aria-hidden="true" />
          <span className={railDoneClass} style={{ width: `${donePercent}%` }} aria-hidden="true" />

          {checkpoints.map((checkpoint, index) => {
            const state = index < safeIndex ? "past" : index === safeIndex ? "current" : "future";
            const glyph = KIND_GLYPH[checkpoint.kind ?? "edit"];

            return (
              <span key={checkpoint.id} className={nodeWrapClass}>
                <button
                  type="button"
                  ref={(el) => {
                    nodeRefs.current[index] = el;
                  }}
                  className={nodeClass}
                  data-state={state}
                  // Roving tabindex: the strip is one tab stop.
                  tabIndex={index === safeIndex ? 0 : -1}
                  aria-current={index === safeIndex ? "step" : undefined}
                  aria-label={`${checkpoint.label}${index === currentIndex ? " (current session state)" : ""}`}
                  disabled={checkpoint.disabled}
                  onClick={() => select(index)}
                  onKeyDown={(event) => onKeyDown(event, index)}
                >
                  {index === currentIndex && index !== safeIndex ? (
                    <span className={currentRingClass} aria-hidden="true" />
                  ) : null}
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d={glyph}
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <span className={nodeLabelClass}>{checkpoint.label}</span>
              </span>
            );
          })}
        </div>
      </div>

      {inspected ? (
        <div className={detailClass}>
          <span className={detailTitleClass}>{inspected.label}</span>

          <span className={detailMetaClass}>
            {elapsed ? <span>+{elapsed}</span> : null}
            {inspected.files !== undefined ? (
              <span>
                {inspected.files} {inspected.files === 1 ? "file" : "files"}
              </span>
            ) : null}
            {inspected.additions !== undefined ? (
              <span className={addTextClass}>+{inspected.additions}</span>
            ) : null}
            {inspected.deletions !== undefined ? (
              <span className={delTextClass}>−{inspected.deletions}</span>
            ) : null}
          </span>

          {inspected.detail}

          {confirming ? (
            <span className={confirmClass}>
              <span className={confirmTextClass} role="alert">
                Discard everything after this point?
              </span>
              <button type="button" className={cancelButtonClass} onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={dangerButtonClass}
                onClick={() => {
                  setConfirming(false);
                  onRewind?.(inspected.id);
                }}
              >
                Rewind
              </button>
            </span>
          ) : onRewind ? (
            <button
              type="button"
              className={rewindButtonClass}
              disabled={!canRewind}
              title={
                safeIndex === currentIndex
                  ? "Already at this checkpoint"
                  : safeIndex > currentIndex
                    ? "Cannot rewind forward"
                    : undefined
              }
              onClick={() => setConfirming(true)}
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path
                  d="M2 7a5 5 0 1 0 1.5-3.5M2 1.5V4h2.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Rewind here
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
