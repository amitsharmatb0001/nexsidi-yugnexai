"use client";

import { computePosition, css, scaleIn, scaleOut, themeVars as theme, type Placement } from "@yugnex/core";
import { useClickOutside, useEscapeKey, usePortal, usePresence } from "@yugnex/core/client";
import {
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

interface DropdownMenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  anchorRef: MutableRefObject<HTMLElement | null>;
  itemsRef: MutableRefObject<HTMLElement[]>;
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(null);

function useDropdownMenuContext(component: string): DropdownMenuContextValue {
  const ctx = useContext(DropdownMenuContext);
  if (!ctx) throw new Error(`<${component}> must be used within <DropdownMenu>`);
  return ctx;
}

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): (node: T | null) => void {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as { current: T | null }).current = node;
    }
  };
}

const contentClass = css({
  position: "fixed",
  top: 0,
  left: 0,
  zIndex: theme.zIndex.dropdown,
  minWidth: "10rem",
  padding: theme.space[1],
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.popover,
  color: theme.color.popoverForeground,
  boxShadow: theme.shadow.lg,
  '&[data-state="open"]': { animation: `${scaleIn} ${theme.duration.fast} ${theme.easing.decelerate}` },
  '&[data-state="closed"]': { animation: `${scaleOut} ${theme.duration.fast} ${theme.easing.accelerate}` },
});

const itemClass = css({
  display: "flex",
  alignItems: "center",
  width: "100%",
  padding: `${theme.space[2]} ${theme.space[2.5]}`,
  borderRadius: theme.radius.sm,
  border: "none",
  backgroundColor: "transparent",
  color: theme.color.popoverForeground,
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.sm,
  textAlign: "left",
  cursor: "pointer",
  "&:hover, &:focus": {
    backgroundColor: theme.color.accent,
    color: theme.color.accentForeground,
    outline: "none",
  },
  '&[aria-disabled="true"]': {
    opacity: 0.5,
    cursor: "not-allowed",
  },
});

export interface DropdownMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function DropdownMenu({ open, onOpenChange, children }: DropdownMenuProps) {
  const anchorRef = useRef<HTMLElement | null>(null);
  const itemsRef = useRef<HTMLElement[]>([]);

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen: onOpenChange, anchorRef, itemsRef }}>
      {children}
    </DropdownMenuContext.Provider>
  );
}

export interface DropdownMenuTriggerProps {
  children: ReactElement;
}

export function DropdownMenuTrigger({ children }: DropdownMenuTriggerProps) {
  const { open, setOpen, anchorRef } = useDropdownMenuContext("DropdownMenuTrigger");
  const element = children as ReactElement<Record<string, unknown>>;
  const childRef = (element as { ref?: Ref<HTMLElement> }).ref;

  return cloneElement(element, {
    ref: mergeRefs(anchorRef, childRef),
    "aria-haspopup": "menu",
    "aria-expanded": open,
    onClick: () => setOpen(!open),
  });
}

export interface DropdownMenuContentProps extends HTMLAttributes<HTMLDivElement> {
  placement?: Placement;
  children: ReactNode;
}

export function DropdownMenuContent({
  placement = "bottom",
  className,
  children,
  ...props
}: DropdownMenuContentProps) {
  const { open, setOpen, anchorRef, itemsRef } = useDropdownMenuContext("DropdownMenuContent");
  const { mounted, dataState } = usePresence(open, { exitDuration: 150 });
  const portalNode = usePortal();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEscapeKey(() => setOpen(false), open);
  useClickOutside(contentRef, () => setOpen(false), open);

  useEffect(() => {
    // Keyed on `mounted`, not `open`: the content node only exists once
    // `mounted` flips true one tick after `open` does (see usePresence).
    if (!mounted) return;
    const raf = requestAnimationFrame(() => {
      if (contentRef.current) {
        itemsRef.current = Array.from(contentRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]'));
        itemsRef.current[0]?.focus();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [mounted, itemsRef]);

  useEffect(() => {
    if (!open || !anchorRef.current || !contentRef.current) return;
    const update = () => {
      if (!anchorRef.current || !contentRef.current) return;
      const result = computePosition(anchorRef.current, contentRef.current, { placement, align: "start" });
      setPos({ x: result.x, y: result.y });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, placement, mounted, anchorRef]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = itemsRef.current;
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(currentIndex + 1 + items.length) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1]?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      // Items are plain divs (role="menuitem"), not buttons, so they don't
      // get native Enter/Space activation — wire it up explicitly.
      event.preventDefault();
      items[currentIndex]?.click();
    } else if (event.key.length === 1 && /\S/.test(event.key)) {
      const char = event.key.toLowerCase();
      const start = (currentIndex + 1) % items.length;
      for (let i = 0; i < items.length; i++) {
        const item = items[(start + i) % items.length]!;
        if (item.textContent?.trim().toLowerCase().startsWith(char)) {
          item.focus();
          break;
        }
      }
    }
  };

  if (!mounted || !portalNode) return null;

  return createPortal(
    <div
      ref={contentRef}
      role="menu"
      data-state={dataState}
      className={className ? `${contentClass} ${className}` : contentClass}
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {children}
    </div>,
    portalNode,
  );
}

export interface DropdownMenuItemProps extends HTMLAttributes<HTMLDivElement> {
  onSelect?: () => void;
  disabled?: boolean;
}

export function DropdownMenuItem({
  onSelect,
  disabled,
  className,
  onClick,
  ...props
}: DropdownMenuItemProps) {
  const { setOpen } = useDropdownMenuContext("DropdownMenuItem");

  return (
    <div
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      className={className ? `${itemClass} ${className}` : itemClass}
      onClick={(event) => {
        if (disabled) return;
        onClick?.(event);
        onSelect?.();
        setOpen(false);
      }}
      {...props}
    />
  );
}
