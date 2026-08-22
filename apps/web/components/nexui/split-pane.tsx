"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { useControllableState } from "@yugnex/core/client";
import { useCallback, useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

const rootClass = css({
  display: "flex",
  width: "100%",
  height: "100%",
  minHeight: 0,
  minWidth: 0,
  overflow: "hidden",
  '&[data-orientation="vertical"]': { flexDirection: "column" },
});

const paneClass = css({
  minWidth: 0,
  minHeight: 0,
  overflow: "auto",
});

const handleClass = css({
  position: "relative",
  flexShrink: 0,
  border: "none",
  padding: 0,
  backgroundColor: theme.color.border,
  transitionProperty: "background-color",
  transitionDuration: theme.duration.fast,
  '&[data-orientation="horizontal"]': { width: "1px", cursor: "col-resize", height: "100%" },
  '&[data-orientation="vertical"]': { height: "1px", cursor: "row-resize", width: "100%" },
  "&:hover, &[data-dragging='true']": { backgroundColor: theme.color.primary },
  "&:focus-visible": { outline: `2px solid ${theme.color.ring}`, outlineOffset: "1px" },
  // A 1px divider is too small to grab, so an invisible pseudo-element widens
  // the hit area to ~9px without changing the visible line or the layout.
  "&::after": {
    content: '""',
    position: "absolute",
    inset: 0,
  },
  '&[data-orientation="horizontal"]::after': { left: "-4px", right: "-4px" },
  '&[data-orientation="vertical"]::after': { top: "-4px", bottom: "-4px" },
});

export interface SplitPaneProps {
  children: [ReactNode, ReactNode];
  orientation?: "horizontal" | "vertical";
  /** First pane's size as a percentage of the container. */
  size?: number;
  defaultSize?: number;
  onSizeChange?: (size: number) => void;
  minSize?: number;
  maxSize?: number;
  /** Percentage points moved per arrow-key press. */
  keyboardStep?: number;
  label?: string;
  className?: string;
}

/**
 * Two resizable panes with a draggable divider — the chat-plus-preview layout
 * agent workspaces need.
 *
 * The divider is a real focusable `separator` with `aria-valuenow`, resizable
 * by arrow keys as well as pointer, so the layout isn't mouse-only. Dragging
 * listens on `window` (not the handle) so the pointer can leave the divider
 * mid-drag without the resize sticking, and sizes are stored as percentages so
 * the split survives container resizes.
 */
export function SplitPane({
  children,
  orientation = "horizontal",
  size,
  defaultSize = 50,
  onSizeChange,
  minSize = 15,
  maxSize = 85,
  keyboardStep = 2,
  label = "Resize panes",
  className,
}: SplitPaneProps) {
  const [current, setCurrent] = useControllableState({
    value: size,
    defaultValue: defaultSize,
    onChange: onSizeChange,
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const handleId = useId();

  const clamp = useCallback(
    (value: number) => Math.min(Math.max(value, minSize), maxSize),
    [minSize, maxSize],
  );

  const setFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio =
        orientation === "horizontal"
          ? (clientX - rect.left) / rect.width
          : (clientY - rect.top) / rect.height;
      setCurrent(clamp(ratio * 100));
    },
    [orientation, clamp, setCurrent],
  );

  useEffect(() => {
    function onMove(event: PointerEvent) {
      if (!draggingRef.current) return;
      event.preventDefault();
      setFromPointer(event.clientX, event.clientY);
    }
    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [setFromPointer]);

  function startDrag() {
    draggingRef.current = true;
    // Suppress text selection and keep the resize cursor while dragging.
    document.body.style.userSelect = "none";
    document.body.style.cursor = orientation === "horizontal" ? "col-resize" : "row-resize";
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const decrease = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
    const increase = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
    if (event.key === decrease) {
      event.preventDefault();
      setCurrent(clamp(current - keyboardStep));
    } else if (event.key === increase) {
      event.preventDefault();
      setCurrent(clamp(current + keyboardStep));
    } else if (event.key === "Home") {
      event.preventDefault();
      setCurrent(minSize);
    } else if (event.key === "End") {
      event.preventDefault();
      setCurrent(maxSize);
    } else if (event.key === "Enter") {
      event.preventDefault();
      setCurrent(clamp(50));
    }
  }

  const [first, second] = children;
  const firstStyle = orientation === "horizontal" ? { width: `${current}%` } : { height: `${current}%` };

  return (
    <div ref={containerRef} className={className ? `${rootClass} ${className}` : rootClass} data-orientation={orientation}>
      <div className={paneClass} style={{ ...firstStyle, flexShrink: 0 }}>
        {first}
      </div>
      <button
        type="button"
        id={handleId}
        role="separator"
        aria-label={label}
        aria-orientation={orientation === "horizontal" ? "vertical" : "horizontal"}
        aria-valuenow={Math.round(current)}
        aria-valuemin={minSize}
        aria-valuemax={maxSize}
        tabIndex={0}
        data-orientation={orientation}
        data-dragging={draggingRef.current || undefined}
        className={handleClass}
        onPointerDown={startDrag}
        onKeyDown={onKeyDown}
      />
      <div className={paneClass} style={{ flex: 1 }}>
        {second}
      </div>
    </div>
  );
}
