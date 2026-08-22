"use client";

import { css } from "@yugnex/core";
import { useRef, type CSSProperties, type MouseEvent, type ReactNode } from "react";

const wrapperClass = css({
  perspective: "1200px",
});

const cardClass = css({
  transformStyle: "preserve-3d",
  willChange: "transform",
});

export interface TiltCardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Max rotation in degrees at the card's edge. */
  maxTilt?: number;
}

/**
 * Wraps children in a mouse-tracked 3D perspective tilt. Transform is written
 * directly to the DOM node (not via React state) so tracking stays 1:1 with
 * the cursor at 60fps; only the return-to-neutral on mouseleave gets a CSS
 * transition, giving it a magnetic snap-back feel.
 */
export function TiltCard({ children, className, style, maxTilt = 10 }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  function handleMouseMove(event: MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const rotateY = (x - 0.5) * maxTilt * 2;
    const rotateX = (0.5 - y) * maxTilt * 2;
    el.style.transition = "transform 0ms";
    el.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.02)`;
  }

  function handleMouseLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.transition = "transform 400ms cubic-bezier(0.2, 0, 0, 1)";
    el.style.transform = "rotateX(0deg) rotateY(0deg) scale(1)";
  }

  return (
    <div className={wrapperClass} style={style}>
      <div
        ref={ref}
        className={className ? `${cardClass} ${className}` : cardClass}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </div>
    </div>
  );
}
