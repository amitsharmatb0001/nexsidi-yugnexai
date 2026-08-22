"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { useControllableState } from "@yugnex/core/client";
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
  baseId: string;
  orderRef: MutableRefObject<string[]>;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error(`<${component}> must be used within <Tabs>`);
  return ctx;
}

function triggerId(baseId: string, value: string): string {
  return `${baseId}-trigger-${value}`;
}

function panelId(baseId: string, value: string): string {
  return `${baseId}-panel-${value}`;
}

const listClass = css({
  display: "inline-flex",
  alignItems: "center",
  gap: theme.space[1],
  padding: "4px",
  borderRadius: theme.radius.md,
  backgroundColor: theme.color.muted,
});

const triggerClass = css({
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: `${theme.space[1.5]} ${theme.space[3]}`,
  borderRadius: theme.radius.sm,
  border: "none",
  backgroundColor: "transparent",
  color: theme.color.mutedForeground,
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.sm,
  fontWeight: theme.fontWeight.medium,
  cursor: "pointer",
  transitionProperty: "background-color, color",
  transitionDuration: theme.duration.fast,
  transitionTimingFunction: theme.easing.standard,
  '&[data-state="active"]': {
    backgroundColor: theme.color.background,
    color: theme.color.foreground,
    boxShadow: theme.shadow.sm,
  },
  "&:focus-visible": {
    outline: `2px solid ${theme.color.ring}`,
    outlineOffset: "2px",
  },
});

const panelClass = css({
  marginTop: theme.space[3],
  "&:focus-visible": {
    outline: `2px solid ${theme.color.ring}`,
    outlineOffset: "2px",
  },
});

export interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({ value, defaultValue, onValueChange, children, className }: TabsProps) {
  const [current, setCurrent] = useControllableState({
    value,
    defaultValue: defaultValue ?? "",
    onChange: onValueChange,
  });
  const baseId = useId();
  const orderRef = useRef<string[]>([]);

  const ctx = useMemo<TabsContextValue>(
    () => ({ value: current, setValue: setCurrent, baseId, orderRef }),
    [current, setCurrent, baseId],
  );

  return (
    <TabsContext.Provider value={ctx}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export const TabsList = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function TabsList(
  { className, onKeyDown, children, ...props },
  ref,
) {
  const { orderRef, value, setValue, baseId } = useTabsContext("TabsList");

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const order = orderRef.current;
    if (order.length === 0) return;
    const currentIndex = order.indexOf(value);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1 + order.length) % order.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + order.length) % order.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = order.length - 1;

    if (nextIndex !== null) {
      event.preventDefault();
      const nextValue = order[nextIndex]!;
      setValue(nextValue);
      document.getElementById(triggerId(baseId, nextValue))?.focus();
    }
  };

  return (
    <div
      ref={ref}
      role="tablist"
      className={className ? `${listClass} ${className}` : listClass}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {children}
    </div>
  );
});

export interface TabsTriggerProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value"> {
  value: string;
}

export const TabsTrigger = forwardRef<HTMLButtonElement, TabsTriggerProps>(function TabsTrigger(
  { value, className, children, ...props },
  ref,
) {
  const { value: activeValue, setValue, baseId, orderRef } = useTabsContext("TabsTrigger");

  useEffect(() => {
    if (!orderRef.current.includes(value)) orderRef.current.push(value);
    return () => {
      orderRef.current = orderRef.current.filter((v) => v !== value);
    };
  }, [value, orderRef]);

  const isActive = activeValue === value;

  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      id={triggerId(baseId, value)}
      aria-selected={isActive}
      aria-controls={panelId(baseId, value)}
      data-state={isActive ? "active" : "inactive"}
      tabIndex={isActive ? 0 : -1}
      className={className ? `${triggerClass} ${className}` : triggerClass}
      onClick={() => setValue(value)}
      {...props}
    >
      {children}
    </button>
  );
});

export interface TabsPanelProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
}

export const TabsPanel = forwardRef<HTMLDivElement, TabsPanelProps>(function TabsPanel(
  { value, className, children, ...props },
  ref,
) {
  const { value: activeValue, baseId } = useTabsContext("TabsPanel");
  if (activeValue !== value) return null;

  return (
    <div
      ref={ref}
      role="tabpanel"
      id={panelId(baseId, value)}
      aria-labelledby={triggerId(baseId, value)}
      tabIndex={0}
      className={className ? `${panelClass} ${className}` : panelClass}
      {...props}
    >
      {children}
    </div>
  );
});
