"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { useRef, type CSSProperties, type MouseEvent, type ReactNode } from "react";

const containerClass = css({
  position: "relative",
  overflow: "hidden",
  "--spotlight-x": "50%",
  "--spotlight-y": "50%",
  "&::before": {
    content: '""',
    position: "absolute",
    inset: 0,
    background: `radial-gradient(360px circle at var(--spotlight-x) var(--spotlight-y), ${theme.color.accent}, transparent 70%)`,
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: theme.duration.slow,
    pointerEvents: "none",
  },
  "&:hover::before": {
    opacity: 1,
  },
});

export interface SpotlightProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** A cursor-tracked radial spotlight glow behind the content, visible on hover. */
export function Spotlight({ children, className, style }: SpotlightProps) {
  const ref = useRef<HTMLDivElement>(null);

  function handleMouseMove(event: MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--spotlight-x", `${event.clientX - rect.left}px`);
    el.style.setProperty("--spotlight-y", `${event.clientY - rect.top}px`);
  }

  return (
    <div
      ref={ref}
      className={className ? `${containerClass} ${className}` : containerClass}
      style={style}
      onMouseMove={handleMouseMove}
    >
      {children}
    </div>
  );
}
