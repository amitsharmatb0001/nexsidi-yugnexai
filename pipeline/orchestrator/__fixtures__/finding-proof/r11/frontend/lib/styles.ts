"use client";
import { css, themeVars as theme } from "@yugnex/core";

export const layoutCss = {
  pageContainer: css({
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: theme.color.background,
    color: theme.color.foreground,
  }),
  mainContent: css({
    flex: 1,
  }),
  section: css({
    padding: `${theme.space[16]} ${theme.space[6]}`,
    "@media (min-width: 768px)": {
      padding: `${theme.space[24]} ${theme.space[8]}`,
    }
  }),
  container: css({
    maxWidth: "1200px",
    margin: "0 auto",
  }),
  panel: css({
    padding: theme.space[6],
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.card,
    border: `1px solid ${theme.color.border}`,
  })
};