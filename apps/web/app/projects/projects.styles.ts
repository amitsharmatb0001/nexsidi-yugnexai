import { css, keyframes, themeVars as theme } from "@yugnex/core";
import { breathe, eyebrow, ground, readout, signal } from "@/lib/design";

/**
 * The project list — moved here from what used to be /dashboard, which is
 * now a separate overview page. This is the exhaustive, working view: every
 * project, its real pipeline stage (not just building/done/failed), whether
 * it needs your approval right now, and what it has cost so far.
 */
const sweepIn = keyframes({
  from: { opacity: 0, transform: "translateY(10px)" },
  to: { opacity: 1, transform: "translateY(0)" },
});

export const projects = {
  main: css({
    position: "relative",
    maxWidth: "1080px",
    margin: "0 auto",
    padding: `${theme.space[8]} ${theme.space[5]} ${theme.space[16]}`,
  }),

  masthead: css({
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: theme.space[6],
    marginBottom: theme.space[6],
    animation: `${sweepIn} ${theme.duration.slow} ${theme.easing.decelerate} both`,
  }),

  mastheadTitle: css({
    margin: 0,
    fontFamily: "var(--nx-font-family-display)",
    fontSize: "28px",
    lineHeight: 1.1,
    fontWeight: theme.fontWeight.bold,
    letterSpacing: "-0.025em",
    color: theme.color.foreground,
  }),

  eyebrow,
  readout,

  errorBanner: css({
    marginBottom: theme.space[4],
    padding: `${theme.space[2.5]} ${theme.space[3]}`,
    borderRadius: theme.radius.sm,
    border: `1px solid ${signal.failDim}`,
    backgroundColor: signal.failDim,
    color: signal.fail,
    fontSize: theme.fontSize.sm,
  }),

  list: css({
    display: "flex",
    flexDirection: "column",
    border: `1px solid ${ground.seam}`,
    borderRadius: theme.radius.md,
    backgroundColor: ground.panel,
    overflow: "hidden",
  }),

  row: css({
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: theme.space[3],
    padding: `${theme.space[3]} ${theme.space[4]}`,
    borderTop: `1px solid ${ground.seam}`,
    transitionProperty: "background-color",
    transitionDuration: theme.duration.fast,
    "&:first-of-type": { borderTop: "none" },
    "&:hover": { backgroundColor: ground.raised },
  }),

  rowEdge: css({
    position: "absolute",
    insetBlock: 0,
    left: 0,
    width: "2px",
    backgroundColor: "transparent",
  }),
  rowEdgeLive: css({ backgroundColor: signal.machine }),
  rowEdgeWait: css({ backgroundColor: signal.human }),
  rowEdgeFail: css({ backgroundColor: signal.fail }),

  link: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[3],
    flex: 1,
    minWidth: 0,
    color: "inherit",
    textDecoration: "none",
  }),

  node: css({
    position: "relative",
    flexShrink: 0,
    width: "8px",
    height: "8px",
    borderRadius: theme.radius.full,
    border: `1px solid ${ground.seamStrong}`,
  }),
  nodeReady: css({ backgroundColor: signal.ok, borderColor: signal.ok }),
  nodeFailed: css({ backgroundColor: signal.fail, borderColor: signal.fail }),
  nodeBuilding: css({
    backgroundColor: signal.machine,
    borderColor: signal.machine,
    animation: `${breathe} 1.8s ${theme.easing.standard} infinite`,
  }),
  nodeWaiting: css({
    backgroundColor: signal.human,
    borderColor: signal.human,
    animation: `${breathe} 1.4s ${theme.easing.standard} infinite`,
  }),

  rowText: css({
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
  }),

  rowNameLine: css({
    display: "flex",
    alignItems: "baseline",
    gap: theme.space[2.5],
    minWidth: 0,
  }),

  rowName: css({
    fontFamily: "var(--nx-font-family-display)",
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    letterSpacing: "-0.01em",
    color: theme.color.foreground,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }),

  rowId: css({
    fontFamily: theme.fontFamily.mono,
    fontSize: "11px",
    color: theme.color.mutedForeground,
    opacity: 0.7,
    flexShrink: 0,
  }),

  /** The real pipeline stage message — "Running quality checks...", not
   * just "Building". This is the field the dashboard used to collapse away. */
  rowStageMessage: css({
    fontSize: "12px",
    color: theme.color.mutedForeground,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }),

  rowMeta: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[4],
    flexShrink: 0,
    fontFamily: theme.fontFamily.mono,
    fontSize: "11px",
    fontVariantNumeric: "tabular-nums",
    color: theme.color.mutedForeground,
  }),

  metaCol: css({
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "1px",
    minWidth: "72px",
  }),
  metaColLabel: css({
    fontSize: "9px",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    opacity: 0.6,
  }),

  needsApprovalBadge: css({
    display: "inline-flex",
    alignItems: "center",
    gap: theme.space[1],
    padding: `2px ${theme.space[2]}`,
    borderRadius: theme.radius.full,
    border: `1px solid ${signal.humanEdge}`,
    backgroundColor: signal.humanDim,
    color: signal.humanBright,
    fontFamily: theme.fontFamily.mono,
    fontSize: "10px",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    flexShrink: 0,
  }),

  actions: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[1],
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: theme.duration.fast,
    "&:focus-within": { opacity: 1 },
  }),

  iconBtn: css({
    display: "grid",
    placeItems: "center",
    width: "26px",
    height: "26px",
    borderRadius: theme.radius.sm,
    border: "1px solid transparent",
    background: "transparent",
    color: theme.color.mutedForeground,
    cursor: "pointer",
    transitionProperty: "color, border-color, background-color",
    transitionDuration: theme.duration.fast,
    "&:hover": {
      color: theme.color.foreground,
      borderColor: ground.seamStrong,
      backgroundColor: ground.overlay,
    },
  }),

  iconBtnDanger: css({
    "&:hover": {
      color: signal.fail,
      borderColor: signal.failDim,
      backgroundColor: signal.failDim,
    },
  }),

  renameInput: css({
    flex: 1,
    minWidth: 0,
    padding: `${theme.space[1.5]} ${theme.space[2]}`,
    borderRadius: theme.radius.sm,
    border: `1px solid ${signal.humanEdge}`,
    backgroundColor: ground.void,
    color: theme.color.foreground,
    fontFamily: "var(--nx-font-family-display)",
    fontSize: theme.fontSize.sm,
    outline: "none",
    "&:focus": { borderColor: signal.human },
  }),

  confirmRow: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[3],
    padding: `${theme.space[3]} ${theme.space[4]}`,
    borderTop: `1px solid ${ground.seam}`,
    backgroundColor: signal.failDim,
    "&:first-of-type": { borderTop: "none" },
  }),

  confirmText: css({
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.color.foreground,
  }),

  skeletonBar: css({
    height: "17px",
    borderRadius: theme.radius.sm,
    backgroundColor: ground.raised,
    animation: `${breathe} 1.6s ${theme.easing.standard} infinite`,
  }),

  emptyWrap: css({
    padding: `${theme.space[12]} ${theme.space[4]}`,
  }),
};
