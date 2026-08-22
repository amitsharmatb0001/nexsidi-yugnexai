"use client";

import { css, keyframes, themeVars as theme } from "@yugnex/core";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ReviewGate, type ReviewDecision, type ReviewState } from "./review-gate";

/* ------------------------------------------------------------------ *
 * Viewports
 * ------------------------------------------------------------------ */

export interface Viewport {
  id: string;
  label: string;
  /** CSS width; `null` fills the available space. */
  width: number | null;
  height?: number | null;
}

export const DEFAULT_VIEWPORTS: Viewport[] = [
  { id: "responsive", label: "Fill", width: null },
  { id: "mobile", label: "Mobile", width: 390, height: 844 },
  { id: "tablet", label: "Tablet", width: 834, height: 1112 },
  { id: "desktop", label: "Desktop", width: 1280, height: 800 },
];

/**
 * `stalled` rather than `error` on purpose.
 *
 * An iframe's `onError` does not fire for a dead server, a 404, or a 500 —
 * the browser navigates to its own error page and reports a perfectly normal
 * `load`. So a failed preview is not something the parent can *detect*, only
 * something it can *time out*. Naming the state after what we actually know
 * keeps the UI honest: the app has not signalled ready yet.
 */
export type PreviewStatus = "loading" | "ready" | "stalled";

/* ------------------------------------------------------------------ *
 * Styles
 * ------------------------------------------------------------------ */

const spin = keyframes({ from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } });

const rootClass = css({
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  borderRadius: theme.radius.lg,
  border: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.card,
  overflow: "hidden",
  fontFamily: theme.fontFamily.sans,
});

const toolbarClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[2],
  padding: theme.space[2],
  borderBottom: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.muted,
  flexWrap: "wrap",
});

const urlClass = css({
  flex: 1,
  minWidth: "8rem",
  padding: `${theme.space[1]} ${theme.space[2]}`,
  borderRadius: theme.radius.sm,
  border: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.background,
  color: theme.color.mutedForeground,
  fontFamily: theme.fontFamily.mono,
  fontSize: theme.fontSize.xs,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const iconButtonClass = css({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1.75rem",
  height: "1.75rem",
  flexShrink: 0,
  borderRadius: theme.radius.sm,
  border: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.background,
  color: theme.color.foreground,
  cursor: "pointer",
  padding: 0,
  transitionProperty: "background-color, border-color",
  transitionDuration: theme.duration.fast,
  "&:hover": { borderColor: theme.color.ring },
  "&:focus-visible": { outline: `2px solid ${theme.color.ring}`, outlineOffset: "1px" },
});

const viewportGroupClass = css({
  display: "inline-flex",
  gap: "2px",
  padding: "2px",
  borderRadius: theme.radius.sm,
  backgroundColor: theme.color.background,
  border: `1px solid ${theme.color.border}`,
});

const viewportButtonClass = css({
  padding: `${theme.space[0.5]} ${theme.space[2]}`,
  borderRadius: theme.radius.sm,
  border: "none",
  backgroundColor: "transparent",
  color: theme.color.mutedForeground,
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.xs,
  cursor: "pointer",
  transitionProperty: "background-color, color",
  transitionDuration: theme.duration.fast,
  "&:hover": { color: theme.color.foreground },
  "&:focus-visible": { outline: `2px solid ${theme.color.ring}`, outlineOffset: "1px" },
  '&[aria-pressed="true"]': {
    backgroundColor: theme.color.primary,
    color: theme.color.primaryForeground,
  },
});

const stageClass = css({
  position: "relative",
  flex: 1,
  minHeight: 0,
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: theme.space[3],
  backgroundColor: theme.color.muted,
  overflow: "auto",
});

const frameShellClass = css({
  position: "relative",
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  backgroundColor: "#ffffff",
  boxShadow: theme.shadow.md,
  overflow: "hidden",
  maxWidth: "100%",
});

const iframeClass = css({
  display: "block",
  width: "100%",
  height: "100%",
  border: "none",
});

const overlayClass = css({
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: theme.space[2],
  backgroundColor: theme.color.card,
  color: theme.color.mutedForeground,
  fontSize: theme.fontSize.sm,
  textAlign: "center",
  padding: theme.space[4],
});

const spinnerClass = css({
  width: "1.25rem",
  height: "1.25rem",
  borderRadius: "9999px",
  border: `2px solid ${theme.color.border}`,
  borderTopColor: theme.color.primary,
  animation: `${spin} 0.7s linear infinite`,
});

const gateWrapClass = css({
  borderTop: `1px solid ${theme.color.border}`,
  padding: theme.space[2],
  backgroundColor: theme.color.card,
});

const dimensionsClass = css({
  fontFamily: theme.fontFamily.mono,
  fontSize: theme.fontSize.xs,
  color: theme.color.mutedForeground,
  fontVariantNumeric: "tabular-nums",
  flexShrink: 0,
});

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export interface PreviewFrameProps {
  /** URL of the running app. */
  src: string;
  title?: string;
  viewports?: Viewport[];
  defaultViewport?: string;
  /** Frame height when the viewport does not specify one. */
  height?: number | string;
  /**
   * Sandbox attribute for the iframe. The default allows scripts and
   * same-origin so a real dev server renders, which also means the framed app
   * can reach out of the sandbox — only point this at previews you trust.
   */
  sandbox?: string;
  /**
   * How long to wait for the frame's `load` before showing the stalled state,
   * in ms. A cold dev server can take a while, so this is deliberately
   * generous. Pass 0 to never show it.
   */
  loadTimeout?: number;
  /** Renders a review gate under the frame. */
  reviewId?: string;
  reviewState?: ReviewState;
  onDecide?: (decision: ReviewDecision) => void;
  onClear?: (scope: "document" | "section" | "file" | "hunk", id: string) => void;
  /** Replaces the built-in toolbar. */
  toolbar?: ReactNode;
  className?: string;
}

/**
 * A live app preview with device sizing, wrapping the review gate.
 *
 * Exists for the moment a generated UI is running but wrong: the reviewer
 * needs to see the real thing at a real width and say so in the same place,
 * rather than switching to a diff to reject code they judged visually.
 */
export function PreviewFrame({
  src,
  title = "App preview",
  viewports = DEFAULT_VIEWPORTS,
  defaultViewport,
  height = 520,
  sandbox = "allow-scripts allow-same-origin allow-forms allow-popups",
  loadTimeout = 15000,
  reviewId,
  reviewState,
  onDecide,
  onClear,
  toolbar,
  className,
}: PreviewFrameProps) {
  const [viewportId, setViewportId] = useState(defaultViewport ?? viewports[0]?.id ?? "responsive");
  const [status, setStatus] = useState<PreviewStatus>("loading");
  // Bumping this remounts the iframe, which is the only reliable cross-origin
  // way to force a reload — touching contentWindow.location would throw.
  const [reloadKey, setReloadKey] = useState(0);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const viewport = useMemo(
    () => viewports.find((v) => v.id === viewportId) ?? viewports[0],
    [viewports, viewportId],
  );

  const reload = useCallback(() => {
    setStatus("loading");
    setReloadKey((key) => key + 1);
  }, []);

  // Keyed on reloadKey so each (re)mount of the iframe gets a fresh window.
  useEffect(() => {
    if (loadTimeout <= 0 || status !== "loading") return;
    const timer = setTimeout(() => setStatus("stalled"), loadTimeout);
    return () => clearTimeout(timer);
  }, [loadTimeout, status, reloadKey]);

  const frameWidth = viewport?.width ?? null;
  const frameHeight = viewport?.height ?? height;

  return (
    <div className={className ? `${rootClass} ${className}` : rootClass}>
      {toolbar ?? (
        <div className={toolbarClass}>
          <button type="button" className={iconButtonClass} onClick={reload} aria-label="Reload preview">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M12 7a5 5 0 1 1-1.5-3.5M12 1.5V4H9.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <span className={urlClass} title={src}>
            {src}
          </span>

          <div className={viewportGroupClass} role="group" aria-label="Viewport size">
            {viewports.map((v) => (
              <button
                key={v.id}
                type="button"
                className={viewportButtonClass}
                aria-pressed={v.id === viewportId}
                onClick={() => setViewportId(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>

          {frameWidth ? (
            <span className={dimensionsClass}>
              {frameWidth}×{typeof frameHeight === "number" ? frameHeight : "auto"}
            </span>
          ) : null}
        </div>
      )}

      <div className={stageClass}>
        <div
          className={frameShellClass}
          style={{
            width: frameWidth ? `${frameWidth}px` : "100%",
            height: typeof frameHeight === "number" ? `${frameHeight}px` : frameHeight,
          }}
        >
          <iframe
            key={reloadKey}
            ref={frameRef}
            src={src}
            title={title}
            className={iframeClass}
            sandbox={sandbox}
            onLoad={() => setStatus("ready")}
          />

          {status !== "ready" ? (
            <div className={overlayClass} role="status" aria-live="polite">
              {status === "loading" ? (
                <>
                  <span className={spinnerClass} aria-hidden="true" />
                  <span>Starting preview…</span>
                </>
              ) : (
                <>
                  <span>The preview has not loaded yet. The dev server may still be starting, or may not be running.</span>
                  <button type="button" className={iconButtonClass} onClick={reload} aria-label="Retry preview">
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path
                        d="M12 7a5 5 0 1 1-1.5-3.5M12 1.5V4H9.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {reviewId ? (
        <div className={gateWrapClass}>
          <ReviewGate
            scope="document"
            id={reviewId}
            label="Does this look right?"
            variant="inline"
            value={reviewState}
            onDecide={onDecide}
            onClear={onClear}
          />
        </div>
      ) : null}
    </div>
  );
}
