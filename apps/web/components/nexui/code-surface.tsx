"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { useState, type ReactNode } from "react";

const rootClass = css({
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.muted,
  overflow: "hidden",
  fontFamily: theme.fontFamily.mono,
});

const headerClass = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: theme.space[2],
  padding: `${theme.space[2]} ${theme.space[3]}`,
  borderBottom: `1px solid ${theme.color.border}`,
  fontSize: theme.fontSize.xs,
  color: theme.color.mutedForeground,
});

const filenameClass = css({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const copyButtonClass = css({
  display: "inline-flex",
  alignItems: "center",
  gap: theme.space[1],
  padding: `${theme.space[1]} ${theme.space[2]}`,
  borderRadius: theme.radius.sm,
  border: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.card,
  color: theme.color.foreground,
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.xs,
  cursor: "pointer",
  flexShrink: 0,
  transitionProperty: "background-color, border-color",
  transitionDuration: theme.duration.fast,
  "&:hover": { borderColor: theme.color.ring },
  "&:focus-visible": { outline: `2px solid ${theme.color.ring}`, outlineOffset: "1px" },
});

const scrollClass = css({
  overflowX: "auto",
  padding: theme.space[3],
});

const preClass = css({
  margin: 0,
  fontSize: theme.fontSize.xs,
  lineHeight: 1.6,
  color: theme.color.foreground,
});

const lineClass = css({
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: theme.space[3],
});

const lineNoClass = css({
  userSelect: "none",
  textAlign: "right",
  color: theme.color.mutedForeground,
  fontVariantNumeric: "tabular-nums",
});

export interface CodeSurfaceProps {
  code: string;
  /** Shown in the header, e.g. "app/page.tsx". */
  filename?: ReactNode;
  /** Shown on the right of the header when no filename is set, e.g. "bash". */
  language?: string;
  showLineNumbers?: boolean;
  showCopy?: boolean;
  className?: string;
}

/**
 * A code display surface with a filename header, optional line numbers, and a
 * copy button — the shape LLM answers and docs both need.
 *
 * Deliberately does **not** syntax highlight: doing that properly means
 * shipping a grammar/tokenizer, which would dwarf this component and drag a
 * dependency into a library that has none. Highlight upstream (Shiki server-side,
 * for instance) and pass the result into `children` of your own wrapper, or use
 * this as-is for plain, readable code.
 */
export function CodeSurface({
  code,
  filename,
  language,
  showLineNumbers = false,
  showCopy = true,
  className,
}: CodeSurfaceProps) {
  const [copied, setCopied] = useState(false);
  const lines = code.replace(/\n$/, "").split("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can reject (insecure context, denied permission). Leave the
      // label unchanged rather than claiming a copy that did not happen.
    }
  }

  const showHeader = Boolean(filename || language || showCopy);

  return (
    <div className={className ? `${rootClass} ${className}` : rootClass}>
      {showHeader ? (
        <div className={headerClass}>
          <span className={filenameClass}>{filename ?? language ?? ""}</span>
          {showCopy ? (
            <button type="button" className={copyButtonClass} onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className={scrollClass}>
        <pre className={preClass}>
          <code>
            {showLineNumbers
              ? lines.map((line, i) => (
                  <span className={lineClass} key={i}>
                    <span className={lineNoClass}>{i + 1}</span>
                    <span>{line || " "}</span>
                  </span>
                ))
              : code}
          </code>
        </pre>
      </div>
    </div>
  );
}
