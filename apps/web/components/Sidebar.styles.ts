"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { eyebrow, ground, signal } from "@/lib/design";

/**
 * The nav shell shared by every authenticated page outside the IDE (which
 * keeps its own title bar — a persistent sidebar there would fight the
 * explorer for the same edge of the screen).
 */
export const sidebar = {
  shell: css({
    display: "grid",
    gridTemplateColumns: "220px 1fr",
    minHeight: "100dvh",
    backgroundColor: ground.void,
  }),

  rail: css({
    position: "sticky",
    top: 0,
    height: "100dvh",
    display: "flex",
    flexDirection: "column",
    borderRight: `1px solid ${ground.seam}`,
    backgroundColor: ground.base,
    padding: `${theme.space[4]} ${theme.space[3]}`,
  }),

  brand: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[2],
    padding: `${theme.space[1]} ${theme.space[2]}`,
    marginBottom: theme.space[5],
    fontFamily: "var(--nx-font-family-display)",
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: theme.color.foreground,
    textDecoration: "none",
  }),

  nav: css({
    display: "flex",
    flexDirection: "column",
    gap: "1px",
  }),

  navItem: css({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space[2],
    padding: `${theme.space[2]} ${theme.space[2.5]}`,
    borderRadius: theme.radius.sm,
    fontSize: theme.fontSize.sm,
    color: theme.color.mutedForeground,
    textDecoration: "none",
    transitionProperty: "background-color, color",
    transitionDuration: theme.duration.fast,
    "&:hover": { backgroundColor: ground.raised, color: theme.color.foreground },
  }),

  navItemActive: css({
    backgroundColor: ground.raised,
    color: theme.color.foreground,
    boxShadow: `inset 2px 0 0 ${signal.human}`,
  }),

  navSpacer: css({ flex: 1 }),

  main: css({
    minWidth: 0,
  }),

  topbar: css({
    position: "sticky",
    top: 0,
    zIndex: 20,
    display: "flex",
    alignItems: "center",
    gap: theme.space[3],
    height: "52px",
    padding: `0 ${theme.space[5]}`,
    borderBottom: `1px solid ${ground.seam}`,
    backgroundColor: "rgba(7, 9, 13, 0.86)",
    backdropFilter: "blur(12px)",
  }),

  topbarSpacer: css({ flex: 1 }),

  eyebrow,
};
