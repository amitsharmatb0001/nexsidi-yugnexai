"use client";

import { computePosition, css, scaleIn, scaleOut, themeVars as theme, type Placement } from "@yugnex/core";
import { usePortal, usePresence } from "@yugnex/core/client";
import { cloneElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";

const tooltipClass = css({
  position: "fixed",
  top: 0,
  left: 0,
  zIndex: theme.zIndex.tooltip,
  padding: `${theme.space[1.5]} ${theme.space[2.5]}`,
  borderRadius: theme.radius.sm,
  backgroundColor: theme.color.foreground,
  color: theme.color.background,
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.xs,
  boxShadow: theme.shadow.md,
  pointerEvents: "none",
  '&[data-state="open"]': {
    animation: `${scaleIn} ${theme.duration.fast} ${theme.easing.decelerate}`,
  },
  '&[data-state="closed"]': {
    animation: `${scaleOut} ${theme.duration.fast} ${theme.easing.accelerate}`,
  },
});

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): (node: T | null) => void {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as { current: T | null }).current = node;
    }
  };
}

export interface TooltipProps {
  /** A single element (must forward its ref, e.g. a native tag or a forwardRef component). */
  children: ReactElement;
  content: ReactNode;
  placement?: Placement;
  delay?: number;
}

export function Tooltip({ children, content, placement = "top", delay = 200 }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);
  const floatingRef = useRef<HTMLDivElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const portalNode = usePortal();
  const { mounted, dataState } = usePresence(open, { exitDuration: 150 });
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!open || !anchorRef.current || !floatingRef.current) return;
    const update = () => {
      if (!anchorRef.current || !floatingRef.current) return;
      const result = computePosition(anchorRef.current, floatingRef.current, { placement });
      setPos({ x: result.x, y: result.y });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, placement, mounted]);

  const show = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(false);
  };

  // Cast to a generic props shape so we can inject a merged ref + handlers via
  // cloneElement regardless of the child's own prop types (the same pattern
  // Radix's Slot uses for polymorphic triggers).
  const element = children as ReactElement<Record<string, unknown>>;
  const childRef = (element as { ref?: Ref<HTMLElement> }).ref;

  const trigger = cloneElement(element, {
    ref: mergeRefs(anchorRef, childRef),
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
    "aria-describedby": open ? id : undefined,
  });

  return (
    <>
      {trigger}
      {mounted && portalNode
        ? createPortal(
            <div
              ref={floatingRef}
              role="tooltip"
              id={id}
              data-state={dataState}
              className={tooltipClass}
              style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
            >
              {content}
            </div>,
            portalNode,
          )
        : null}
    </>
  );
}
