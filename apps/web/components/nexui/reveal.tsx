"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const wrapperClass = css({ perspective: "1000px" });

const innerClass = css({
  opacity: 0,
  transform: "translateY(28px) rotateX(-10deg)",
  transformOrigin: "top center",
  transitionProperty: "opacity, transform",
  transitionDuration: "700ms",
  transitionTimingFunction: theme.easing.decelerate,
  '&[data-visible="true"]': {
    opacity: 1,
    transform: "translateY(0) rotateX(0deg)",
  },
});

export interface RevealProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Stagger delay in ms, for sequencing a group of Reveals. */
  delay?: number;
}

/** Fades + 3D-rotates children in the first time they scroll into view. */
export function Reveal({ children, className, style, delay = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={wrapperClass}>
      <div
        ref={ref}
        data-visible={visible}
        className={className ? `${innerClass} ${className}` : innerClass}
        style={{ transitionDelay: `${delay}ms`, ...style }}
      >
        {children}
      </div>
    </div>
  );
}
