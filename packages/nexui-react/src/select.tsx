"use client";
// @yugnex/nexui-react — Select
// Fully custom, keyboard-navigable, ARIA-compliant dropdown select.
// No native <select>. Works with keyboard (arrows, Enter, Escape, Home/End).

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

interface SelectContextValue {
  value:     string;
  open:      boolean;
  onChange:  (v: string, label: string) => void;
  close:     () => void;
  labelFor:  (v: string) => string;
  registerOption: (v: string, label: string) => void;
  focusedIdx: number;
  options:   Array<{ value: string; label: string; disabled?: boolean }>;
  setFocusedIdx: (i: number) => void;
}
const SelectContext = createContext<SelectContextValue>({} as SelectContextValue);

interface SelectProps {
  value?:       string;
  defaultValue?: string;
  onChange?:    (value: string) => void;
  placeholder?: string;
  disabled?:    boolean;
  size?:        "sm" | "md" | "lg";
  error?:       string;
  label?:       string;
  children?:    ReactNode;
  className?:   string;
  style?:       CSSProperties;
}

export function Select({
  value: controlledValue,
  defaultValue = "",
  onChange,
  placeholder = "Select...",
  disabled,
  size = "md",
  error,
  label,
  children,
  className,
  style,
}: SelectProps) {
  const [internal, setInternal] = useState(defaultValue);
  const [open, setOpen]         = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const [options, setOptions]   = useState<Array<{ value: string; label: string; disabled?: boolean }>>([]);
  const [labelMap, setLabelMap] = useState<Record<string, string>>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef    = useRef<HTMLUListElement>(null);
  const id         = useId();

  const value = controlledValue !== undefined ? controlledValue : internal;

  const registerOption = useCallback((v: string, lbl: string) => {
    setLabelMap(m => ({ ...m, [v]: lbl }));
    setOptions(prev => {
      if (prev.find(o => o.value === v)) return prev;
      return [...prev, { value: v, label: lbl }];
    });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setFocusedIdx(-1);
    triggerRef.current?.focus();
  }, []);

  const handleChange = useCallback((v: string, lbl: string) => {
    setInternal(v);
    onChange?.(v);
    close();
  }, [onChange, close]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const trigger = triggerRef.current;
      const list    = listRef.current;
      if (!trigger?.contains(e.target as Node) && !list?.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, close]);

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const enabled = options.filter(o => !o.disabled);
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        if (!open) { setOpen(true); setFocusedIdx(0); }
        else if (focusedIdx >= 0) handleChange(enabled[focusedIdx]?.value ?? "", enabled[focusedIdx]?.label ?? "");
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "ArrowDown":
        e.preventDefault();
        if (!open) { setOpen(true); setFocusedIdx(0); }
        else setFocusedIdx(i => Math.min(i + 1, enabled.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setFocusedIdx(i => Math.max(i - 1, 0));
        break;
      case "Home":
        e.preventDefault();
        setFocusedIdx(0);
        break;
      case "End":
        e.preventDefault();
        setFocusedIdx(enabled.length - 1);
        break;
    }
  };

  const sizeH: Record<string, string> = { sm: "28px", md: "34px", lg: "40px" };
  const sizeFS: Record<string, string> = { sm: "11px", md: "13px", lg: "14px" };
  const h  = sizeH[size]  ?? sizeH.md;
  const fs = sizeFS[size] ?? sizeFS.md;

  const displayLabel = value ? (labelMap[value] ?? value) : "";

  return (
    <SelectContext.Provider value={{
      value, open, onChange: handleChange, close,
      labelFor: (v) => labelMap[v] ?? v,
      registerOption, focusedIdx, options, setFocusedIdx,
    }}>
      <div className={className} style={{ position: "relative", display: "inline-block", width: "100%", ...style }}>
        {label && (
          <label
            htmlFor={`${id}-btn`}
            style={{ display: "block", fontSize: "12px", fontWeight: 500, color: "var(--nx-text-2, #8B949E)", marginBottom: 5, fontFamily: "var(--nx-font-sans, system-ui, sans-serif)" }}
          >
            {label}
          </label>
        )}
        <button
          id={`${id}-btn`}
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          onClick={() => !disabled && setOpen(o => !o)}
          onKeyDown={handleKeyDown}
          style={{
            width: "100%",
            height: h,
            padding: "0 10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            background: "var(--nx-bg-elevated, #1C2128)",
            border: `1px solid ${error ? "var(--nx-error, #EF4444)" : open ? "var(--nx-border-focus, rgba(232,144,16,0.60))" : "var(--nx-border, rgba(255,255,255,0.08))"}`,
            borderRadius: "6px",
            color: displayLabel ? "var(--nx-text, #E6EDF3)" : "var(--nx-text-4, #484F58)",
            fontFamily: "var(--nx-font-sans, system-ui, sans-serif)",
            fontSize: fs,
            fontWeight: 400,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.45 : 1,
            outline: "none",
            boxShadow: open ? `0 0 0 3px rgba(232,144,16,0.12)` : "none",
            transition: "border-color 150ms ease, box-shadow 150ms ease",
          }}
        >
          <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {displayLabel || placeholder}
          </span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms ease", flexShrink: 0, opacity: 0.6 }}>
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>
        {error && <span style={{ fontSize: "11px", color: "var(--nx-error, #EF4444)", marginTop: 4, display: "block", fontFamily: "var(--nx-font-sans, system-ui, sans-serif)" }}>{error}</span>}
        {open && (
          <ul
            id={`${id}-list`}
            ref={listRef}
            role="listbox"
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              marginTop: 4,
              background: "var(--nx-bg-elevated, #1C2128)",
              border: "1px solid var(--nx-border-strong, rgba(255,255,255,0.16))",
              borderRadius: 8,
              boxShadow: "0 10px 15px rgba(0,0,0,0.50), 0 4px 6px rgba(0,0,0,0.30)",
              padding: "4px 0",
              zIndex: 50,
              maxHeight: 240,
              overflowY: "auto",
              listStyle: "none",
              margin: 0,
              animation: "nx-slide-up 150ms ease forwards",
            }}
          >
            {children}
          </ul>
        )}
      </div>
    </SelectContext.Provider>
  );
}

interface SelectItemProps {
  value:      string;
  children:   ReactNode;
  disabled?:  boolean;
}

export function SelectItem({ value, children, disabled }: SelectItemProps) {
  const ctx = useContext(SelectContext);
  const label = typeof children === "string" ? children : value;

  useEffect(() => { ctx.registerOption(value, label); }, [value, label]);

  const enabledOptions = ctx.options.filter(o => !o.disabled);
  const myIdx = enabledOptions.findIndex(o => o.value === value);
  const isFocused = ctx.focusedIdx === myIdx;
  const isSelected = ctx.value === value;

  return (
    <li
      role="option"
      aria-selected={isSelected}
      aria-disabled={disabled}
      onClick={() => !disabled && ctx.onChange(value, label)}
      onMouseEnter={() => !disabled && ctx.setFocusedIdx(myIdx)}
      style={{
        padding: "7px 12px",
        fontSize: "var(--nx-fs-sm, 12px)",
        fontFamily: "var(--nx-font-sans, system-ui, sans-serif)",
        color: disabled ? "var(--nx-text-4, #484F58)" : isSelected ? "var(--nx-accent-text, #F5B342)" : "var(--nx-text, #E6EDF3)",
        background: isFocused ? "var(--nx-bg-overlay, #21262D)" : "transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        transition: "background 100ms ease",
      }}
    >
      <span>{children}</span>
      {isSelected && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5"/>
        </svg>
      )}
    </li>
  );
}

export function SelectGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={{
        padding: "6px 12px 2px",
        fontSize: "10px",
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--nx-text-4, #484F58)",
        fontFamily: "var(--nx-font-sans, system-ui, sans-serif)",
      }}>
        {label}
      </div>
      {children}
    </div>
  );
}
