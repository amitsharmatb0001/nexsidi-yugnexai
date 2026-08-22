"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { FileIcon, type FileStatus } from "./file-icon";

export interface OpenFile {
  /** Full path — the tab's identity. */
  path: string;
  /** Overrides the label derived from `path`. */
  label?: string;
  /** Unsaved changes: shows a dot in place of the close button until hovered. */
  dirty?: boolean;
  status?: FileStatus;
  /** Preview tabs render italic and are replaced by the next preview open. */
  preview?: boolean;
}

const stripClass = css({
  display: "flex",
  alignItems: "stretch",
  gap: "1px",
  overflowX: "auto",
  backgroundColor: theme.color.muted,
  borderBottom: `1px solid ${theme.color.border}`,
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.sm,
  // A tab strip that shows a scrollbar under the tabs looks broken; the
  // overflow still scrolls by wheel, drag, and keyboard.
  scrollbarWidth: "none",
  "&::-webkit-scrollbar": { display: "none" },
});

const tabClass = css({
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  gap: theme.space[1.5],
  flexShrink: 0,
  maxWidth: "14rem",
  padding: `${theme.space[2]} ${theme.space[2]} ${theme.space[2]} ${theme.space[3]}`,
  border: "none",
  borderTop: "2px solid transparent",
  backgroundColor: "transparent",
  color: theme.color.mutedForeground,
  font: "inherit",
  cursor: "pointer",
  transitionProperty: "background-color, color",
  transitionDuration: theme.duration.fast,
  "&:hover": { backgroundColor: theme.color.background, color: theme.color.foreground },
  "&:focus-visible": { outline: `2px solid ${theme.color.ring}`, outlineOffset: "-2px" },
  '&[aria-selected="true"]': {
    backgroundColor: theme.color.background,
    color: theme.color.foreground,
    borderTopColor: theme.color.primary,
  },
});

const previewTabClass = css({ fontStyle: "italic" });

const labelClass = css({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
});

const deletedLabelClass = css({ textDecoration: "line-through", opacity: 0.7 });

/**
 * The close button and the dirty dot occupy the same slot: the dot is the
 * resting state for an unsaved file and swaps to the ✕ on hover/focus, which
 * is how every editor handles it — a permanent ✕ next to a permanent dot
 * reads as two separate controls.
 */
const closeSlotClass = css({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  width: "1.125rem",
  height: "1.125rem",
  marginLeft: theme.space[0.5],
  borderRadius: theme.radius.sm,
  border: "none",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  padding: 0,
  "&:hover": { backgroundColor: theme.color.border },
  "&:focus-visible": { outline: `2px solid ${theme.color.ring}`, outlineOffset: "1px" },
});

const dirtyDotClass = css({
  width: "8px",
  height: "8px",
  borderRadius: "9999px",
  backgroundColor: "currentColor",
  '[data-dirty="true"]:not(:hover) &': { display: "block" },
});

const closeIconClass = css({
  display: "none",
  '[data-dirty="false"] &, [data-dirty="true"]:hover &, [data-dirty="true"]:focus-within &': {
    display: "block",
  },
});

const dirtyDotHideOnHoverClass = css({
  '[data-dirty="true"]:hover &, [data-dirty="true"]:focus-within &': { display: "none" },
});

const statusBarClass = css({
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  height: "2px",
});

const STATUS_COLOR: Record<Exclude<FileStatus, "unchanged">, string> = {
  new: theme.color.success,
  modified: theme.color.warning,
  deleted: theme.color.destructive,
};

export interface FileTabsProps {
  files: OpenFile[];
  /** Path of the active tab. */
  active?: string;
  onActivate?: (path: string) => void;
  onClose?: (path: string) => void;
  /** Accessible name for the strip. */
  label?: string;
  className?: string;
}

/**
 * The strip of open files above an editor pane.
 *
 * Distinct from `tabs`, which is a content switcher: these carry a file
 * identity (icon, dirty state, changeset status), close individually, and
 * are expected to come and go as an agent opens files — so the tab list is
 * data, not markup.
 */
export function FileTabs({ files, active, onActivate, onClose, label = "Open files", className }: FileTabsProps) {
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const stripRef = useRef<HTMLDivElement | null>(null);

  // Keep the active tab on screen — an agent switching files faster than the
  // user can scroll would otherwise leave the highlighted tab out of view.
  useEffect(() => {
    if (!active) return;
    tabRefs.current.get(active)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  const focusByOffset = (from: string, offset: number) => {
    const index = files.findIndex((file) => file.path === from);
    if (index === -1) return;
    const next = files[(index + offset + files.length) % files.length];
    if (next) tabRefs.current.get(next.path)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, file: OpenFile) => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        focusByOffset(file.path, 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        focusByOffset(file.path, -1);
        break;
      case "Home":
        event.preventDefault();
        if (files[0]) tabRefs.current.get(files[0].path)?.focus();
        break;
      case "End":
        event.preventDefault();
        if (files[files.length - 1]) tabRefs.current.get(files[files.length - 1]!.path)?.focus();
        break;
      // Editors close the focused tab on Delete/Backspace; do the same so the
      // strip is operable without reaching for the ✕.
      case "Delete":
      case "Backspace":
        event.preventDefault();
        onClose?.(file.path);
        break;
      default:
        break;
    }
  };

  const closeTab = (event: MouseEvent, path: string) => {
    // Without this the click also activates the tab being removed.
    event.stopPropagation();
    onClose?.(path);
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      ref={stripRef}
      className={className ? `${stripClass} ${className}` : stripClass}
    >
      {files.map((file) => {
        const isActive = file.path === active;
        const name = file.label ?? (file.path.split("/").pop() ?? file.path);
        const dirty = Boolean(file.dirty);
        const status = file.status && file.status !== "unchanged" ? file.status : undefined;

        return (
          <button
            key={file.path}
            type="button"
            role="tab"
            ref={(el) => {
              if (el) tabRefs.current.set(file.path, el);
              else tabRefs.current.delete(file.path);
            }}
            aria-selected={isActive}
            // Roving tabindex: the whole strip is one tab stop.
            tabIndex={isActive ? 0 : -1}
            data-dirty={dirty}
            title={file.path}
            className={file.preview ? `${tabClass} ${previewTabClass}` : tabClass}
            onClick={() => onActivate?.(file.path)}
            onKeyDown={(event) => onKeyDown(event, file)}
          >
            <FileIcon filename={file.path} size={14} />

            <span className={status === "deleted" ? `${labelClass} ${deletedLabelClass}` : labelClass}>
              {name}
            </span>

            {onClose ? (
              <span
                // A button inside a button is invalid HTML, so the close
                // affordance is a span with an explicit role — it still gets
                // keyboard coverage through the tab's Delete/Backspace
                // handler above.
                role="button"
                tabIndex={-1}
                aria-label={`Close ${name}`}
                className={closeSlotClass}
                onClick={(event) => closeTab(event, file.path)}
              >
                {dirty ? (
                  <span className={`${dirtyDotClass} ${dirtyDotHideOnHoverClass}`} aria-hidden="true" />
                ) : null}
                <svg className={closeIconClass} width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </span>
            ) : null}

            {status ? (
              <span
                className={statusBarClass}
                style={{ backgroundColor: STATUS_COLOR[status] }}
                aria-hidden="true"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
