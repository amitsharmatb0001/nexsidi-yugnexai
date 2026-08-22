"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { useEffect, useState, type HTMLAttributes } from "react";

const kbdClass = css({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "2px",
  minWidth: "1.375rem",
  height: "1.375rem",
  padding: `0 ${theme.space[1.5]}`,
  borderRadius: theme.radius.sm,
  border: `1px solid ${theme.color.border}`,
  borderBottomWidth: "2px",
  backgroundColor: theme.color.muted,
  color: theme.color.mutedForeground,
  fontFamily: theme.fontFamily.sans,
  fontSize: "0.6875rem",
  fontWeight: theme.fontWeight.medium,
  lineHeight: 1,
  whiteSpace: "nowrap",
});

const groupClass = css({ display: "inline-flex", alignItems: "center", gap: "3px" });

const SYMBOLS: Record<string, { mac: string; other: string }> = {
  mod: { mac: "⌘", other: "Ctrl" },
  cmd: { mac: "⌘", other: "Ctrl" },
  meta: { mac: "⌘", other: "Win" },
  alt: { mac: "⌥", other: "Alt" },
  option: { mac: "⌥", other: "Alt" },
  shift: { mac: "⇧", other: "Shift" },
  ctrl: { mac: "⌃", other: "Ctrl" },
  enter: { mac: "↵", other: "Enter" },
  escape: { mac: "esc", other: "Esc" },
  esc: { mac: "esc", other: "Esc" },
  backspace: { mac: "⌫", other: "Backspace" },
  tab: { mac: "⇥", other: "Tab" },
  up: { mac: "↑", other: "↑" },
  down: { mac: "↓", other: "↓" },
  left: { mac: "←", other: "←" },
  right: { mac: "→", other: "→" },
};

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  /** Key names, e.g. ["mod", "K"]. "mod" renders ⌘ on macOS and Ctrl elsewhere. */
  keys: string[];
}

/**
 * Renders a keyboard shortcut. Platform detection runs after mount rather than
 * during render — reading `navigator` while rendering would produce different
 * server and client output and trip a hydration mismatch, so the first paint
 * shows the non-Mac form and swaps on the client if needed.
 */
export function Kbd({ keys, className, ...props }: KbdProps) {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent));
  }, []);

  return (
    <span className={className ? `${groupClass} ${className}` : groupClass} {...props}>
      {keys.map((key, index) => {
        const entry = SYMBOLS[key.toLowerCase()];
        const label = entry ? (isMac ? entry.mac : entry.other) : key.toUpperCase();
        return (
          <kbd key={`${key}-${index}`} className={kbdClass}>
            {label}
          </kbd>
        );
      })}
    </span>
  );
}
