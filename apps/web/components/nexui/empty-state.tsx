"use client";

import { css, themeVars as theme } from "@yugnex/core";
import type { HTMLAttributes, ReactNode } from "react";

const rootClass = css({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  gap: theme.space[2],
  padding: `${theme.space[12]} ${theme.space[6]}`,
  fontFamily: theme.fontFamily.sans,
});

const iconWrapClass = css({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "3rem",
  height: "3rem",
  marginBottom: theme.space[2],
  borderRadius: theme.radius.full,
  backgroundColor: theme.color.muted,
  color: theme.color.mutedForeground,
  fontSize: theme.fontSize.xl,
});

const titleClass = css({
  margin: 0,
  fontSize: theme.fontSize.base,
  fontWeight: theme.fontWeight.semibold,
  color: theme.color.foreground,
});

const descriptionClass = css({
  margin: 0,
  maxWidth: "28rem",
  fontSize: theme.fontSize.sm,
  lineHeight: theme.lineHeight.base,
  color: theme.color.mutedForeground,
});

const actionsClass = css({
  display: "flex",
  gap: theme.space[2],
  marginTop: theme.space[4],
  flexWrap: "wrap",
  justifyContent: "center",
});

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Primary/secondary buttons, rendered below the copy. */
  actions?: ReactNode;
}

/** The zero-data state: no conversations yet, no search results, nothing connected. */
export function EmptyState({ icon, title, description, actions, className, children, ...props }: EmptyStateProps) {
  return (
    <div className={className ? `${rootClass} ${className}` : rootClass} {...props}>
      {icon ? (
        <span className={iconWrapClass} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <p className={titleClass}>{title}</p>
      {description ? <p className={descriptionClass}>{description}</p> : null}
      {children}
      {actions ? <div className={actionsClass}>{actions}</div> : null}
    </div>
  );
}
