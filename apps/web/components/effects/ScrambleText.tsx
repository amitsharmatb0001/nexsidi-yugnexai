"use client";

import { useEffect, useRef, useState } from "react";

// Katakana + latin + symbols — the "ghost in the shell" scramble set
const CHARS = "アイウエオカキクケコサシスセソタチツテト0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%&";

interface ScrambleTextProps {
  text: string;
  /** ms between frames — lower = faster */
  speed?: number;
  /** ms delay before animation starts */
  delay?: number;
  className?: string;
  tag?: "h1" | "h2" | "h3" | "p" | "span";
}

export default function ScrambleText({
  text,
  speed = 28,
  delay = 120,
  className,
  tag: Tag = "span",
}: ScrambleTextProps) {
  const [display, setDisplay] = useState(() =>
    // Start fully scrambled
    text
      .split("")
      .map((ch) => (ch === " " || ch === "\n" ? ch : CHARS[Math.floor(Math.random() * CHARS.length)]))
      .join(""),
  );
  const frameRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    startRef.current = setTimeout(() => {
      const len = text.length;

      timerRef.current = setInterval(() => {
        frameRef.current++;
        // Reveal 1 character every 2 frames for a smooth decode feel
        const revealed = Math.min(Math.floor(frameRef.current * 1.4), len);

        const next = text
          .split("")
          .map((ch, i) => {
            if (ch === " " || ch === "\n") return ch;
            if (i < revealed) return ch;
            return CHARS[Math.floor(Math.random() * CHARS.length)];
          })
          .join("");

        setDisplay(next);

        if (revealed >= len) {
          if (timerRef.current) clearInterval(timerRef.current);
          setDisplay(text);
        }
      }, speed);
    }, delay);

    return () => {
      if (startRef.current) clearTimeout(startRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [text, speed, delay]);

  return <Tag className={className}>{display}</Tag>;
}
