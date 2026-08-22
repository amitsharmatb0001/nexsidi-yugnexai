"use client";

import { css, themeVars as theme } from "@yugnex/core";
import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode } from "react";

const chipClass = css({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: "1.125rem",
  height: "1.125rem",
  padding: `0 ${theme.space[1]}`,
  marginLeft: "2px",
  borderRadius: theme.radius.sm,
  backgroundColor: theme.color.accent,
  color: theme.color.accentForeground,
  fontFamily: theme.fontFamily.sans,
  fontSize: "0.6875rem",
  fontWeight: theme.fontWeight.semibold,
  lineHeight: 1,
  textDecoration: "none",
  verticalAlign: "super",
  cursor: "pointer",
  transitionProperty: "background-color, color",
  transitionDuration: theme.duration.fast,
  "&:hover": {
    backgroundColor: theme.color.primary,
    color: theme.color.primaryForeground,
  },
  "&:focus-visible": {
    outline: `2px solid ${theme.color.ring}`,
    outlineOffset: "1px",
  },
});

export interface CitationProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children"> {
  /** The marker shown in the chip — typically the source's 1-based index. */
  index: number | string;
  /** Source title, used for the accessible name and native tooltip. */
  source?: string;
  href?: string;
}

/**
 * An inline source marker for grounded/RAG answers. Renders as a superscript
 * chip; pair it with <CitationList> to show the full sources beneath a message.
 */
export function Citation({ index, source, href, className, ...props }: CitationProps) {
  const label = source ? `Source ${index}: ${source}` : `Source ${index}`;
  return (
    <a
      className={className ? `${chipClass} ${className}` : chipClass}
      href={href}
      title={source}
      aria-label={label}
      target={href ? "_blank" : undefined}
      rel={href ? "noreferrer noopener" : undefined}
      {...props}
    >
      {index}
    </a>
  );
}

const listClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[1.5],
  margin: 0,
  padding: 0,
  listStyle: "none",
});

const itemClass = css({
  display: "flex",
  alignItems: "flex-start",
  gap: theme.space[2],
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.xs,
  color: theme.color.mutedForeground,
});

const itemIndexClass = css({
  flexShrink: 0,
  minWidth: "1.125rem",
  height: "1.125rem",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: theme.radius.sm,
  backgroundColor: theme.color.muted,
  color: theme.color.mutedForeground,
  fontSize: "0.6875rem",
  fontWeight: theme.fontWeight.semibold,
});

const itemLinkClass = css({
  color: theme.color.foreground,
  textDecoration: "none",
  "&:hover": { textDecoration: "underline" },
});

export interface CitationSource {
  title: string;
  href?: string;
  snippet?: ReactNode;
}

export interface CitationListProps extends HTMLAttributes<HTMLUListElement> {
  sources: CitationSource[];
}

/** The resolved source list for an answer — numbering here matches the inline <Citation> markers. */
export function CitationList({ sources, className, ...props }: CitationListProps) {
  return (
    <ul className={className ? `${listClass} ${className}` : listClass} {...props}>
      {sources.map((source, i) => (
        <li key={`${source.title}-${i}`} className={itemClass}>
          <span className={itemIndexClass} aria-hidden="true">
            {i + 1}
          </span>
          <span>
            {source.href ? (
              <a className={itemLinkClass} href={source.href} target="_blank" rel="noreferrer noopener">
                {source.title}
              </a>
            ) : (
              <span className={itemLinkClass}>{source.title}</span>
            )}
            {source.snippet ? <div>{source.snippet}</div> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
