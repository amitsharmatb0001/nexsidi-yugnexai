import { css, keyframes, themeVars as theme } from "@yugnex/core";
import { breathe, eyebrow, ground, readout, signal } from "@/lib/design";

/**
 * The overview page — real aggregate numbers (cost, tokens, active/needing-
 * approval counts) plus a short recent-projects list, distinct from the full
 * /projects listing. Every card here maps to a real query; nothing here is
 * "Agents Online" / "Workstreams" / platform CPU-memory-disk style invented
 * telemetry — see Sidebar.tsx's own comment for why those don't belong on a
 * customer-facing surface even where some proxy data exists for them.
 */
const sweepIn = keyframes({
  from: { opacity: 0, transform: "translateY(10px)" },
  to: { opacity: 1, transform: "translateY(0)" },
});

export const dashboard = {
  main: css({
    position: "relative",
    maxWidth: "1080px",
    margin: "0 auto",
    padding: `${theme.space[8]} ${theme.space[5]} ${theme.space[16]}`,
  }),

  masthead: css({
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

  mastheadSub: css({
    marginTop: theme.space[2],
    fontSize: theme.fontSize.sm,
    color: theme.color.mutedForeground,
  }),

  eyebrow,
  readout,

  stats: css({
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "1px",
    marginBottom: theme.space[6],
    border: `1px solid ${ground.seam}`,
    borderRadius: theme.radius.md,
    backgroundColor: ground.seam,
    overflow: "hidden",
  }),

  stat: css({
    padding: `${theme.space[3]} ${theme.space[4]}`,
    backgroundColor: ground.panel,
  }),

  statValue: css({
    fontFamily: theme.fontFamily.mono,
    fontSize: "22px",
    fontWeight: theme.fontWeight.medium,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: theme.letterSpacing.tight,
    color: theme.color.foreground,
    lineHeight: 1.2,
  }),

  statValueLive: css({ color: signal.machineBright }),
  statValueWait: css({ color: signal.humanBright }),

  statLabel: css({
    marginTop: theme.space[1],
    fontFamily: theme.fontFamily.mono,
    fontSize: "10px",
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: theme.color.mutedForeground,
  }),

  columns: css({
    display: "grid",
    gridTemplateColumns: "1.4fr 1fr",
    gap: theme.space[5],
    alignItems: "start",
    "@media (max-width: 860px)": { gridTemplateColumns: "1fr" },
  }),

  panel: css({
    border: `1px solid ${ground.seam}`,
    borderRadius: theme.radius.md,
    backgroundColor: ground.panel,
    overflow: "hidden",
  }),

  panelHead: css({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space[3],
    padding: `${theme.space[3]} ${theme.space[4]}`,
    borderBottom: `1px solid ${ground.seam}`,
  }),

  panelHeadLabel: eyebrow,

  panelLink: css({
    fontFamily: theme.fontFamily.mono,
    fontSize: "11px",
    color: theme.color.mutedForeground,
    textDecoration: "none",
    "&:hover": { color: theme.color.foreground },
  }),

  row: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[3],
    padding: `${theme.space[2.5]} ${theme.space[4]}`,
    borderTop: `1px solid ${ground.seam}`,
    textDecoration: "none",
    color: "inherit",
    transitionProperty: "background-color",
    transitionDuration: theme.duration.fast,
    "&:first-of-type": { borderTop: "none" },
    "&:hover": { backgroundColor: ground.raised },
  }),

  node: css({
    flexShrink: 0,
    width: "7px",
    height: "7px",
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
    flex: 1,
  }),

  rowName: css({
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.color.foreground,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }),

  rowSub: css({
    fontSize: "11.5px",
    color: theme.color.mutedForeground,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }),

  rowTime: css({
    flexShrink: 0,
    fontFamily: theme.fontFamily.mono,
    fontSize: "11px",
    color: theme.color.mutedForeground,
  }),

  approveBtn: css({
    flexShrink: 0,
    padding: `${theme.space[1]} ${theme.space[2.5]}`,
    borderRadius: theme.radius.full,
    border: `1px solid ${signal.humanEdge}`,
    backgroundColor: signal.humanDim,
    color: signal.humanBright,
    fontSize: "11px",
    fontWeight: theme.fontWeight.medium,
    textDecoration: "none",
  }),

  empty: css({
    padding: `${theme.space[6]} ${theme.space[4]}`,
    textAlign: "center",
    fontSize: theme.fontSize.sm,
    color: theme.color.mutedForeground,
  }),

  skeletonBar: css({
    height: "16px",
    margin: `${theme.space[2.5]} ${theme.space[4]}`,
    borderRadius: theme.radius.sm,
    backgroundColor: ground.raised,
    animation: `${breathe} 1.6s ${theme.easing.standard} infinite`,
  }),
};
