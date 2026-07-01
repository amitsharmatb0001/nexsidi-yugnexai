"use client";
// @yugnex/nexui-react — Tooltip
// CSS-positioned, no portal. Shows on hover and focus.
// Usage: <Tooltip content="Copy to clipboard"><Button>Copy</Button></Tooltip>

import React, {
  useState,
  useRef,
  useCallback,
  type ReactNode,
  type CSSProperties,
} from "react";

type TooltipSide = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  content:   ReactNode;
  side?:     TooltipSide;
  delay?:    number;
  disabled?: boolean;
  children:  ReactNode;
}

const SIDE_STYLES: Record<TooltipSide, any> = {
  top:    { bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" },
  bottom: { top:    "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" },
  left:   { right:  "calc(100% + 6px)", top:  "50%", transform: "translateY(-50%)" },
  right:  { left:   "calc(100% + 6px)", top:  "50%", transform: "translateY(-50%)" },
};

export function Tooltip({ content, side = "top", delay = 400, disabled, children }: TooltipProps) {
  const [visible, setVisible]     = useState(false);
  const [animated, setAnimated]   = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout>>();
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();

  const show = useCallback(() => {
    clearTimeout(hideTimer.current);
    showTimer.current = setTimeout(() => {
      setVisible(true);
      requestAnimationFrame(() => setAnimated(true));
    }, delay);
  }, [delay]);

  const hide = useCallback(() => {
    clearTimeout(showTimer.current);
    setAnimated(false);
    hideTimer.current = setTimeout(() => setVisible(false), 150);
  }, []);

  if (disabled) return <>{children}</>;

  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            zIndex: 400,
            background: "var(--nx-bg-overlay, #21262D)",
            border: "1px solid var(--nx-border-strong, rgba(255,255,255,0.16))",
            borderRadius: 6,
            padding: "5px 10px",
            fontSize: "var(--nx-fs-xs, 11px)",
            fontFamily: "var(--nx-font-sans, system-ui, sans-serif)",
            fontWeight: 400,
            color: "var(--nx-text, #E6EDF3)",
            whiteSpace: "nowrap",
            boxShadow: "0 4px 6px rgba(0,0,0,0.40)",
            pointerEvents: "none",
            opacity: animated ? 1 : 0,
            transform: `${SIDE_STYLES[side].transform ?? ""} scale(${animated ? 1 : 0.95})`,
            transition: "opacity 150ms ease, transform 150ms ease",
            ...SIDE_STYLES[side],
          }}
        >
          {content}
        </span>
      )}
    </span>
  );
}
