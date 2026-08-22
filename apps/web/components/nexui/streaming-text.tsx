"use client";

import { css, keyframes } from "@yugnex/core";
import { useEffect, useRef, useState, type HTMLAttributes } from "react";

const blink = keyframes({
  "0%, 49%": { opacity: 1 },
  "50%, 100%": { opacity: 0 },
});

const rootClass = css({
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
});

const cursorClass = css({
  display: "inline-block",
  width: "0.5em",
  height: "1em",
  marginLeft: "1px",
  verticalAlign: "text-bottom",
  backgroundColor: "currentColor",
  animation: `${blink} 1s steps(1) infinite`,
  "@media (prefers-reduced-motion: reduce)": {
    animation: "none",
    opacity: 0.6,
  },
});

const srOnlyClass = css({
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
  border: 0,
});

export interface StreamingTextProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** The full text known so far. Safe to grow over time as tokens arrive — the reveal continues, it never restarts. */
  text: string;
  /** Reveal speed in characters per second. */
  charsPerSecond?: number;
  /** Show a blinking caret while text is still being revealed. */
  cursor?: boolean;
  /** Called once when the revealed length catches up to `text`. */
  onComplete?: () => void;
  /** Skip the animation and render `text` immediately. */
  instant?: boolean;
}

/**
 * Reveals text progressively, the way an LLM response appears as it streams.
 *
 * Two details that matter in real use: the reveal is driven by elapsed time
 * rather than a fixed per-character interval, so it stays smooth regardless of
 * frame rate; and it tracks a *character count* rather than restarting when
 * `text` changes, so a prop that grows token-by-token from an API keeps
 * animating continuously instead of flickering back to the start.
 *
 * Respects `prefers-reduced-motion`, rendering the full text immediately.
 * The visible span is aria-hidden while animating and the complete text is
 * exposed to screen readers separately, so assistive tech never announces a
 * half-written word.
 */
export function StreamingText({
  text,
  charsPerSecond = 60,
  cursor = true,
  onComplete,
  instant = false,
  className,
  ...props
}: StreamingTextProps) {
  const [revealed, setRevealed] = useState(instant ? text.length : 0);
  const revealedRef = useRef(revealed);
  revealedRef.current = revealed;

  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (instant) {
      setRevealed(text.length);
      return;
    }

    const reduce =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setRevealed(text.length);
      return;
    }

    if (revealedRef.current >= text.length) return;

    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const elapsed = (now - last) / 1000;
      last = now;
      const next = Math.min(text.length, revealedRef.current + elapsed * charsPerSecond);
      revealedRef.current = next;
      setRevealed(next);
      if (next < text.length) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, charsPerSecond, instant]);

  const done = revealed >= text.length;

  useEffect(() => {
    if (done && !completedRef.current && text.length > 0) {
      completedRef.current = true;
      onCompleteRef.current?.();
    }
    if (!done) completedRef.current = false;
  }, [done, text.length]);

  return (
    <>
      <span aria-hidden={!done} className={className ? `${rootClass} ${className}` : rootClass} {...props}>
        {text.slice(0, Math.floor(revealed))}
        {cursor && !done ? <span className={cursorClass} /> : null}
      </span>
      {done ? null : <span className={srOnlyClass}>{text}</span>}
    </>
  );
}
