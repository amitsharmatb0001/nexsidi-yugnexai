"use client";

// Shared between the dashboard nav and the IDE title bar — one account
// surface, not two independently-maintained copies of the same markup.

import { css, keyframes, themeVars as theme } from "@yugnex/core";

const ease = theme.easing.standard;
const inkQuiet = `color-mix(in srgb, ${theme.color.mutedForeground} 62%, transparent)`;

const cardIn = keyframes({
  from: { opacity: 0, transform: "translateY(3px)" },
  to: { opacity: 1, transform: "none" },
});

export const account = {
  root: css({ position: "relative" }),
  btn: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[2],
    padding: "4px 8px 4px 4px",
    borderRadius: theme.radius.full,
    transition: `background ${theme.duration.base} ${ease}`,
    "&:hover": { background: theme.color.card },
  }),
  avatar: css({
    width: "26px",
    height: "26px",
    flex: "none",
    display: "grid",
    placeItems: "center",
    borderRadius: theme.radius.full,
    background: theme.color.muted,
    color: theme.color.mutedForeground,
    fontSize: "11.5px",
    fontWeight: theme.fontWeight.semibold,
  }),
  name: css({
    fontSize: "12.5px",
    color: theme.color.mutedForeground,
    maxWidth: "140px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    "@media (max-width: 620px)": { display: "none" },
  }),
  menu: css({
    position: "absolute",
    top: "36px",
    right: 0,
    minWidth: "200px",
    padding: theme.space[1],
    borderRadius: theme.radius.md,
    border: `1px solid ${theme.color.border}`,
    background: theme.color.card,
    boxShadow: theme.shadow.lg,
    zIndex: theme.zIndex.dropdown,
    animation: `${cardIn} ${theme.duration.fast} ${ease} both`,
  }),
  menuEmail: css({
    padding: "8px 10px 6px",
    fontSize: "12px",
    color: inkQuiet,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    borderBottom: `1px solid ${theme.color.border}`,
    marginBottom: theme.space[1],
  }),
  menuItem: css({
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "8px 10px",
    borderRadius: theme.radius.sm,
    fontSize: theme.fontSize.sm,
    color: theme.color.mutedForeground,
    transition: `background ${theme.duration.fast} ${ease}, color ${theme.duration.fast} ${ease}`,
    "&:hover": { background: theme.color.muted, color: theme.color.foreground },
  }),
  menuItemAlert: css({
    "&:hover": {
      background: `color-mix(in srgb, ${theme.color.destructive} 10%, transparent)`,
      color: theme.color.destructive,
    },
  }),
};
