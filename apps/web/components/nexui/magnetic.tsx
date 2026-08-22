"use client";

import { css } from "@yugnex/core";
import { useRef, type CSSProperties, type MouseEvent, type ReactNode } from "react";

const wrapClass = css({ display: "inline-block" });

export interface MagneticProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** How strongly the element follows the cursor, 0-1. */
  strength?: number;
}

/** Pulls children toward the cursor on hover, then springs back with a slight overshoot on release. */
export function Magnetic({ children, className, style, strength = 0.3 }: MagneticProps) {
  const ref = useRef<HTMLDivElement>(null);

  function handleMouseMove(event: MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = event.clientX - (rect.left + rect.width / 2);
    const y = event.clientY - (rect.top + rect.height / 2);
    el.style.transition = "transform 0ms";
    el.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
  }

  function handleMouseLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.transition = "transform 500ms cubic-bezier(0.34, 1.56, 0.64, 1)";
    el.style.transform = "translate(0px, 0px)";
  }

  return (
    <div
      ref={ref}
      className={className ? `${wrapClass} ${className}` : wrapClass}
      style={style}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </div>
  );
}
