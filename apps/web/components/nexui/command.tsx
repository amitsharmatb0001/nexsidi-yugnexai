"use client";

import { css, fadeIn, fadeOut, scaleIn, scaleOut, themeVars as theme } from "@yugnex/core";
import { useEscapeKey, usePortal, usePresence } from "@yugnex/core/client";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

const overlayClass = css({
  position: "fixed",
  inset: 0,
  zIndex: theme.zIndex.overlay,
  backgroundColor: theme.color.overlay,
  '&[data-state="open"]': { animation: `${fadeIn} ${theme.duration.base} ${theme.easing.standard}` },
  '&[data-state="closed"]': { animation: `${fadeOut} ${theme.duration.base} ${theme.easing.standard}` },
});

const panelClass = css({
  position: "fixed",
  top: "18%",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: theme.zIndex.modal,
  width: "min(34rem, calc(100vw - 2rem))",
  borderRadius: theme.radius.lg,
  border: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.popover,
  color: theme.color.popoverForeground,
  boxShadow: theme.shadow.overlay,
  overflow: "hidden",
  fontFamily: theme.fontFamily.sans,
  '&[data-state="open"]': { animation: `${scaleIn} ${theme.duration.base} ${theme.easing.decelerate}` },
  '&[data-state="closed"]': { animation: `${scaleOut} ${theme.duration.fast} ${theme.easing.accelerate}` },
});

const inputRowClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[2.5],
  padding: `${theme.space[3]} ${theme.space[4]}`,
  borderBottom: `1px solid ${theme.color.border}`,
});

const inputClass = css({
  flex: 1,
  border: "none",
  outline: "none",
  background: "transparent",
  color: theme.color.foreground,
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.base,
  "&::placeholder": { color: theme.color.mutedForeground },
});

const listClass = css({
  maxHeight: "20rem",
  overflowY: "auto",
  padding: theme.space[1.5],
  margin: 0,
  listStyle: "none",
});

const groupLabelClass = css({
  padding: `${theme.space[2]} ${theme.space[2.5]} ${theme.space[1]}`,
  fontSize: theme.fontSize.xs,
  fontWeight: theme.fontWeight.semibold,
  letterSpacing: theme.letterSpacing.wide,
  textTransform: "uppercase",
  color: theme.color.mutedForeground,
});

const itemClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[2.5],
  padding: `${theme.space[2]} ${theme.space[2.5]}`,
  borderRadius: theme.radius.sm,
  cursor: "pointer",
  fontSize: theme.fontSize.sm,
  '&[data-active="true"]': {
    backgroundColor: theme.color.accent,
    color: theme.color.accentForeground,
  },
});

const itemIconClass = css({ flexShrink: 0, display: "inline-flex", color: theme.color.mutedForeground });
const itemLabelClass = css({ flex: 1, minWidth: 0 });
const itemHintClass = css({ flexShrink: 0, fontSize: theme.fontSize.xs, color: theme.color.mutedForeground });

const emptyClass = css({
  padding: `${theme.space[8]} ${theme.space[4]}`,
  textAlign: "center",
  fontSize: theme.fontSize.sm,
  color: theme.color.mutedForeground,
});

const footerClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[3],
  padding: `${theme.space[2]} ${theme.space[4]}`,
  borderTop: `1px solid ${theme.color.border}`,
  fontSize: theme.fontSize.xs,
  color: theme.color.mutedForeground,
});

export interface CommandItem {
  id: string;
  label: string;
  /** Extra words matched by the filter but not displayed — aliases, synonyms. */
  keywords?: string;
  group?: string;
  icon?: ReactNode;
  /** Right-aligned hint, typically a shortcut. */
  hint?: ReactNode;
  onSelect?: () => void;
}

export interface CommandProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandItem[];
  placeholder?: string;
  emptyMessage?: string;
  footer?: ReactNode;
}

/**
 * A ⌘K command palette: fuzzy-ish substring filtering over label + keywords,
 * arrow/Enter navigation, and grouping.
 *
 * Uses the ARIA combobox pattern — focus stays in the text input while
 * `aria-activedescendant` points at the highlighted row, so typing and
 * navigating never fight over focus.
 */
export function Command({
  open,
  onOpenChange,
  items,
  placeholder = "Type a command or search…",
  emptyMessage = "No results found.",
  footer,
}: CommandProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const { mounted, dataState } = usePresence(open, { exitDuration: 150 });
  const portalNode = usePortal();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const baseId = useId();

  useEscapeKey(() => onOpenChange(false), open);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => `${item.label} ${item.keywords ?? ""}`.toLowerCase().includes(q));
  }, [items, query]);

  // Reset the query and highlight each time the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
  }, [open]);

  // Focus is keyed on `mounted`, not `open`: the portaled input does not exist
  // until a tick after `open` flips, so focusing on `open` would run against a
  // null ref and silently leave focus on whatever opened the palette.
  useEffect(() => {
    if (!mounted) return;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [mounted]);

  // A narrowing filter can strand the highlight past the end of the list.
  useEffect(() => {
    setActiveIndex((current) => (current >= filtered.length ? 0 : current));
  }, [filtered.length]);

  useEffect(() => {
    if (!mounted) return;
    document.getElementById(`${baseId}-item-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [mounted, activeIndex, baseId]);

  useEffect(() => {
    if (!mounted) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [mounted]);

  function run(index: number) {
    const item = filtered[index];
    if (!item) return;
    onOpenChange(false);
    item.onSelect?.();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(filtered.length - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(activeIndex);
    }
  }

  if (!mounted || !portalNode) return null;

  const seenGroups = new Set<string>();

  return createPortal(
    <>
      <div className={overlayClass} data-state={dataState} aria-hidden="true" onClick={() => onOpenChange(false)} />
      <div className={panelClass} data-state={dataState} role="dialog" aria-modal="true" aria-label="Command palette">
        <div className={inputRowClass}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ color: theme.color.mutedForeground }}>
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            className={inputClass}
            placeholder={placeholder}
            value={query}
            role="combobox"
            aria-expanded
            aria-controls={`${baseId}-list`}
            aria-activedescendant={filtered.length ? `${baseId}-item-${activeIndex}` : undefined}
            aria-autocomplete="list"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        {filtered.length === 0 ? (
          <p className={emptyClass}>{emptyMessage}</p>
        ) : (
          <ul className={listClass} id={`${baseId}-list`} role="listbox" aria-label="Commands">
            {filtered.map((item, index) => {
              const showGroup = item.group && !seenGroups.has(item.group);
              if (item.group) seenGroups.add(item.group);
              return (
                <li key={item.id} style={{ listStyle: "none" }}>
                  {showGroup ? (
                    <div className={groupLabelClass} role="presentation">
                      {item.group}
                    </div>
                  ) : null}
                  <div
                    id={`${baseId}-item-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    data-active={index === activeIndex}
                    className={itemClass}
                    onClick={() => run(index)}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    {item.icon ? <span className={itemIconClass}>{item.icon}</span> : null}
                    <span className={itemLabelClass}>{item.label}</span>
                    {item.hint ? <span className={itemHintClass}>{item.hint}</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {footer ? <div className={footerClass}>{footer}</div> : null}
      </div>
    </>,
    portalNode,
  );
}

/** Opens a <Command> on ⌘K / Ctrl+K. Call at the app root alongside the palette. */
export function useCommandShortcut(onOpen: () => void, key = "k"): void {
  const handlerRef = useRef(onOpen);
  handlerRef.current = onOpen;

  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === key) {
        event.preventDefault();
        handlerRef.current();
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [key]);
}
