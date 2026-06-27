"use client";
// @yugnex/nexui-react — Tabs
// Controlled and uncontrolled usage.
// Usage:
//   <Tabs defaultValue="code">
//     <TabsList>
//       <TabsTrigger value="code">Code</TabsTrigger>
//       <TabsTrigger value="preview">Preview</TabsTrigger>
//     </TabsList>
//     <TabsContent value="code"><CodeView /></TabsContent>
//     <TabsContent value="preview"><Preview /></TabsContent>
//   </Tabs>

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

interface TabsContextValue {
  active:   string;
  setActive: (v: string) => void;
}
const TabsContext = createContext<TabsContextValue>({ active: "", setActive: () => {} });

interface TabsProps {
  defaultValue?: string;
  value?:        string;
  onChange?:     (v: string) => void;
  children?:     ReactNode;
  className?:    string;
  style?:        CSSProperties;
}

export function Tabs({ defaultValue = "", value, onChange, children, className, style }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue);
  const active   = value !== undefined ? value : internal;
  const setActive = useCallback((v: string) => {
    setInternal(v);
    onChange?.(v);
  }, [onChange]);

  return (
    <TabsContext.Provider value={{ active, setActive }}>
      <div className={className} style={{ display: "flex", flexDirection: "column", ...style }}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

interface TabsListProps {
  children?:  ReactNode;
  className?: string;
  style?:     CSSProperties;
}

export function TabsList({ children, className, style }: TabsListProps) {
  return (
    <div
      role="tablist"
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        borderBottom: "1px solid var(--nx-border, rgba(255,255,255,0.08))",
        padding: "0 4px",
        overflowX: "auto",
        scrollbarWidth: "none",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

interface TabsTriggerProps {
  value:      string;
  children?:  ReactNode;
  disabled?:  boolean;
  className?: string;
  style?:     CSSProperties;
}

export function TabsTrigger({ value, children, disabled, className, style }: TabsTriggerProps) {
  const { active, setActive } = useContext(TabsContext);
  const isActive = active === value;

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActive(value); }
  };

  return (
    <button
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      disabled={disabled}
      className={className}
      onClick={() => !disabled && setActive(value)}
      onKeyDown={handleKeyDown}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 12px",
        fontSize: "var(--nx-fs-sm, 12px)",
        fontWeight: 500,
        fontFamily: "var(--nx-font-sans, system-ui, sans-serif)",
        color: isActive ? "var(--nx-text, #E6EDF3)" : "var(--nx-text-3, #6E7681)",
        background: "transparent",
        border: "none",
        borderBottom: `2px solid ${isActive ? "var(--nx-accent, #E89010)" : "transparent"}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "color 150ms ease, border-color 150ms ease",
        whiteSpace: "nowrap",
        marginBottom: -1,
        outline: "none",
        borderRadius: "4px 4px 0 0",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

interface TabsContentProps {
  value:      string;
  children?:  ReactNode;
  className?: string;
  style?:     CSSProperties;
}

export function TabsContent({ value, children, className, style }: TabsContentProps) {
  const { active } = useContext(TabsContext);
  if (active !== value) return null;
  return (
    <div role="tabpanel" className={className} style={{ flex: 1, ...style }}>
      {children}
    </div>
  );
}
