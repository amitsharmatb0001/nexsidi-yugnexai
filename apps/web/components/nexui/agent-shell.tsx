"use client";

import { css, themeVars as theme } from "@yugnex/core";
import type { HTMLAttributes, ReactNode } from "react";

const shellClass = css({
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  gridTemplateRows: "auto 1fr",
  gridTemplateAreas: `
    "sidebar header inspector"
    "sidebar main   inspector"
  `,
  height: "100dvh",
  width: "100%",
  overflow: "hidden",
  backgroundColor: theme.color.background,
  color: theme.color.foreground,
  fontFamily: theme.fontFamily.sans,
});

const sidebarClass = css({
  gridArea: "sidebar",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  width: "16rem",
  borderRight: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.card,
  overflowY: "auto",
  transitionProperty: "width, opacity",
  transitionDuration: theme.duration.base,
  transitionTimingFunction: theme.easing.standard,
  '&[data-collapsed="true"]': {
    width: 0,
    opacity: 0,
    overflow: "hidden",
    borderRightWidth: 0,
  },
});

const headerClass = css({
  gridArea: "header",
  display: "flex",
  alignItems: "center",
  gap: theme.space[3],
  minHeight: "3.5rem",
  padding: `0 ${theme.space[4]}`,
  borderBottom: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.background,
});

const mainClass = css({
  gridArea: "main",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  minWidth: 0,
  overflow: "hidden",
});

const inspectorClass = css({
  gridArea: "inspector",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  width: "20rem",
  borderLeft: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.card,
  overflowY: "auto",
  transitionProperty: "width, opacity",
  transitionDuration: theme.duration.base,
  transitionTimingFunction: theme.easing.standard,
  '&[data-collapsed="true"]': {
    width: 0,
    opacity: 0,
    overflow: "hidden",
    borderLeftWidth: 0,
  },
});

/**
 * The frame an agent application sits in: a conversation sidebar, a header, the
 * main transcript area, and a right-hand inspector for traces, context, or
 * state.
 *
 * Built as a CSS grid with named areas so the sidebar and inspector can
 * collapse to zero width without the main column reflowing its children — the
 * transcript keeps its scroll position when a panel toggles. Every region owns
 * its own scroll, so only the transcript moves while the chrome stays put.
 */
export function AgentShell({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={className ? `${shellClass} ${className}` : shellClass} {...props}>
      {children}
    </div>
  );
}

export interface AgentShellPanelProps extends HTMLAttributes<HTMLElement> {
  collapsed?: boolean;
  children: ReactNode;
}

export function AgentSidebar({ collapsed, className, children, ...props }: AgentShellPanelProps) {
  return (
    <aside
      data-collapsed={collapsed || undefined}
      aria-hidden={collapsed || undefined}
      className={className ? `${sidebarClass} ${className}` : sidebarClass}
      {...props}
    >
      {children}
    </aside>
  );
}

export function AgentHeader({ className, children, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <header className={className ? `${headerClass} ${className}` : headerClass} {...props}>
      {children}
    </header>
  );
}

export function AgentMain({ className, children, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <main className={className ? `${mainClass} ${className}` : mainClass} {...props}>
      {children}
    </main>
  );
}

export function AgentInspector({ collapsed, className, children, ...props }: AgentShellPanelProps) {
  return (
    <aside
      data-collapsed={collapsed || undefined}
      aria-hidden={collapsed || undefined}
      aria-label="Inspector"
      className={className ? `${inspectorClass} ${className}` : inspectorClass}
      {...props}
    >
      {children}
    </aside>
  );
}

const scrollAreaClass = css({
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  padding: theme.space[4],
});

/** A scrollable region that fills the remaining height of its shell area. */
export function AgentScrollArea({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={className ? `${scrollAreaClass} ${className}` : scrollAreaClass} {...props}>
      {children}
    </div>
  );
}

const composerClass = css({
  flexShrink: 0,
  padding: theme.space[4],
  borderTop: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.background,
});

/** A pinned footer region for the prompt composer, anchored below the transcript. */
export function AgentComposer({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={className ? `${composerClass} ${className}` : composerClass} {...props}>
      {children}
    </div>
  );
}
