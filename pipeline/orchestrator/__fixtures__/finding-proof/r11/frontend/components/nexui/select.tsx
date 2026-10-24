"use client";

import { computePosition, css, scaleIn, scaleOut, themeVars as theme } from "@yugnex/core";
import { useClickOutside, useControllableState, useEscapeKey, usePortal, usePresence } from "@yugnex/core/client";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

const triggerClass = css({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: theme.space[2],
  width: "100%",
  height: "2.5rem",
  padding: `0 ${theme.space[3]}`,
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.input}`,
  backgroundColor: theme.color.background,
  color: theme.color.foreground,
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.sm,
  cursor: "pointer",
  transitionProperty: "border-color, box-shadow",
  transitionDuration: theme.duration.fast,
  "&:focus-visible": {
    outline: "none",
    borderColor: theme.color.ring,
    boxShadow: `0 0 0 3px ${theme.color.accent}`,
  },
  "&:disabled": { opacity: 0.5, cursor: "not-allowed" },
});

const placeholderClass = css({ color: theme.color.mutedForeground });

const valueClass = css({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  textAlign: "left",
  flex: 1,
});

const chevronClass = css({
  flexShrink: 0,
  color: theme.color.mutedForeground,
  transitionProperty: "transform",
  transitionDuration: theme.duration.fast,
  '[data-state="open"] &': { transform: "rotate(180deg)" },
});

const listboxClass = css({
  position: "fixed",
  top: 0,
  left: 0,
  zIndex: theme.zIndex.dropdown,
  maxHeight: "16rem",
  overflowY: "auto",
  padding: theme.space[1],
  margin: 0,
  listStyle: "none",
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.popover,
  color: theme.color.popoverForeground,
  boxShadow: theme.shadow.lg,
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.sm,
  '&[data-state="open"]': { animation: `${scaleIn} ${theme.duration.fast} ${theme.easing.decelerate}` },
  '&[data-state="closed"]': { animation: `${scaleOut} ${theme.duration.fast} ${theme.easing.accelerate}` },
  "&:focus-visible": { outline: "none" },
});

const optionClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[2],
  padding: `${theme.space[2]} ${theme.space[2.5]}`,
  borderRadius: theme.radius.sm,
  cursor: "pointer",
  userSelect: "none",
  '&[data-active="true"]': {
    backgroundColor: theme.color.accent,
    color: theme.color.accentForeground,
  },
  '&[aria-disabled="true"]': { opacity: 0.5, cursor: "not-allowed" },
});

const checkClass = css({ marginLeft: "auto", flexShrink: 0 });

const groupLabelClass = css({
  padding: `${theme.space[1.5]} ${theme.space[2.5]}`,
  fontSize: theme.fontSize.xs,
  fontWeight: theme.fontWeight.semibold,
  letterSpacing: theme.letterSpacing.wide,
  textTransform: "uppercase",
  color: theme.color.mutedForeground,
});

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  /** Options sharing a group render under one heading, in the order first seen. */
  group?: string;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Accessible name when there's no visible <label> wired to `id`. */
  label?: string;
  id?: string;
  className?: string;
}

/**
 * A single-select dropdown following the ARIA listbox-popup pattern: focus
 * moves into the list and `aria-activedescendant` tracks the highlighted
 * option, so screen readers announce each option as you arrow through without
 * the DOM focus churn of moving focus per item. Supports arrows, Home/End,
 * Enter/Space, Escape, and printable-character typeahead.
 */
export function Select({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder = "Select…",
  disabled,
  label,
  id,
  className,
}: SelectProps) {
  const [selected, setSelected] = useControllableState<string | undefined>({
    value,
    defaultValue,
    onChange: (next) => next != null && onValueChange?.(next),
  });

  const [open, setOpen] = useState(false);
  const { mounted, dataState } = usePresence(open, { exitDuration: 150 });
  const portalNode = usePortal();

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0, width: 0 });

  const enabled = options.filter((o) => !o.disabled);
  const selectedOption = options.find((o) => o.value === selected);

  const [activeIndex, setActiveIndex] = useState(0);
  const baseId = useId();
  const optionId = (index: number) => `${baseId}-option-${index}`;

  useEscapeKey(() => setOpen(false), open);
  useClickOutside(listRef, () => setOpen(false), open);

  useEffect(() => {
    if (!mounted) return;
    const update = () => {
      if (!triggerRef.current || !listRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const result = computePosition(triggerRef.current, listRef.current, { placement: "bottom", align: "start" });
      setPos({ x: result.x, y: result.y, width: rect.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [mounted]);

  // Read through refs so this effect can depend on `open` alone. Callers
  // routinely pass an inline `options={[...]}` array, whose identity changes
  // every render — depending on it directly would re-run this on each render
  // and snap the highlight back to the selected item mid-keyboard-navigation.
  const latest = useRef({ options, selected });
  latest.current = { options, selected };

  // Open with the current selection highlighted.
  useEffect(() => {
    if (!open) return;
    const { options: opts, selected: current } = latest.current;
    const index = opts.findIndex((o) => o.value === current);
    setActiveIndex(index >= 0 ? index : opts.findIndex((o) => !o.disabled));
  }, [open]);

  // Focus is keyed on `mounted`, not `open`: the portaled <ul> only exists a
  // tick after `open` flips, so focusing on `open` reads a null ref and leaves
  // focus on the trigger — where arrow keys would never reach the listbox.
  useEffect(() => {
    if (!mounted) return;
    const raf = requestAnimationFrame(() => listRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [mounted]);

  // Keep the highlighted option scrolled into view as arrows move past the edge.
  useEffect(() => {
    if (!mounted) return;
    document.getElementById(`${baseId}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [mounted, activeIndex, baseId]);

  const typeaheadRef = useRef({ query: "", timer: 0 });

  const moveActive = useCallback(
    (direction: 1 | -1) => {
      setActiveIndex((current) => {
        // Walk outward until we land on an enabled option, wrapping at both ends.
        for (let step = 1; step <= options.length; step++) {
          const raw = current + direction * step;
          const next = ((raw % options.length) + options.length) % options.length;
          if (!options[next]?.disabled) return next;
        }
        return current;
      });
    },
    [options],
  );

  function commit(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    setSelected(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(options.findIndex((o) => !o.disabled));
    } else if (event.key === "End") {
      event.preventDefault();
      for (let i = options.length - 1; i >= 0; i--) {
        if (!options[i]?.disabled) {
          setActiveIndex(i);
          break;
        }
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commit(activeIndex);
    } else if (event.key === "Tab") {
      setOpen(false);
    } else if (event.key.length === 1 && /\S/.test(event.key)) {
      // Typeahead: repeated characters build a query for ~600ms.
      const state = typeaheadRef.current;
      window.clearTimeout(state.timer);
      state.query += event.key.toLowerCase();
      state.timer = window.setTimeout(() => (state.query = ""), 600);
      const match = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(state.query));
      if (match >= 0) setActiveIndex(match);
    }
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
    }
  }

  // Group headings render inline before the first option of each group.
  const seenGroups = new Set<string>();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={mounted ? `${baseId}-listbox` : undefined}
        aria-label={label}
        disabled={disabled || enabled.length === 0}
        data-state={open ? "open" : "closed"}
        className={className ? `${triggerClass} ${className}` : triggerClass}
        onClick={() => setOpen(!open)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={selectedOption ? valueClass : `${valueClass} ${placeholderClass}`}>
          {selectedOption?.label ?? placeholder}
        </span>
        <svg className={chevronClass} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3 5.5L7 9.5L11 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {mounted && portalNode
        ? createPortal(
            <ul
              ref={listRef}
              id={`${baseId}-listbox`}
              role="listbox"
              tabIndex={-1}
              aria-label={label ?? placeholder}
              aria-activedescendant={optionId(activeIndex)}
              data-state={dataState}
              className={listboxClass}
              style={{ transform: `translate(${pos.x}px, ${pos.y}px)`, minWidth: pos.width }}
              onKeyDown={handleListKeyDown}
            >
              {options.map((option, index) => {
                const showGroup = option.group && !seenGroups.has(option.group);
                if (option.group) seenGroups.add(option.group);
                return (
                  <li key={option.value} style={{ listStyle: "none" }}>
                    {showGroup ? (
                      <div className={groupLabelClass} role="presentation">
                        {option.group}
                      </div>
                    ) : null}
                    <div
                      id={optionId(index)}
                      role="option"
                      aria-selected={option.value === selected}
                      aria-disabled={option.disabled || undefined}
                      data-active={index === activeIndex}
                      className={optionClass}
                      onClick={() => commit(index)}
                      onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                    >
                      <span>
                        {option.label}
                        {option.description ? (
                          <span style={{ display: "block", fontSize: "0.75rem", opacity: 0.7 }}>
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                      {option.value === selected ? (
                        <svg className={checkClass} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                          <path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>,
            portalNode,
          )
        : null}
    </>
  );
}

export interface SelectFieldProps extends SelectProps {
  fieldLabel?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
}

const fieldLabelClass = css({
  display: "block",
  marginBottom: theme.space[1.5],
  fontSize: theme.fontSize.sm,
  fontWeight: theme.fontWeight.medium,
  color: theme.color.foreground,
});

const fieldHelpClass = css({
  marginTop: theme.space[1.5],
  fontSize: theme.fontSize.xs,
  color: theme.color.mutedForeground,
});

const fieldErrorClass = css({
  marginTop: theme.space[1.5],
  fontSize: theme.fontSize.xs,
  color: theme.color.destructive,
});

/** <Select> wrapped with a visible label, description, and error text. */
export function SelectField({ fieldLabel, description, error, id, ...props }: SelectFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <div>
      {fieldLabel ? (
        <label className={fieldLabelClass} htmlFor={fieldId}>
          {fieldLabel}
        </label>
      ) : null}
      <Select id={fieldId} {...props} />
      {description ? <p className={fieldHelpClass}>{description}</p> : null}
      {error ? (
        <p className={fieldErrorClass} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
