import { css, themeVars as theme } from "@yugnex/core";
import { breathe, eyebrow, ground, readout, scan, signal } from "@/lib/design";

/**
 * The planning screen: a conversation on the left, the spec it is producing on
 * the right, and one review gate between them.
 *
 * The right pane is the point of the screen. The plan is not a preview that
 * appears once and waits — it fills in as the model writes it, and the gate
 * under it is what turns "here is a plan" into a decision the operator makes.
 */
export const planning = {
  root: css({
    display: "flex",
    flexDirection: "column",
    height: "100dvh",
    overflow: "hidden",
    backgroundColor: ground.void,
    color: theme.color.foreground,
  }),

  /* ── Title rail ────────────────────────────────────────────────────── */

  rail: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[3],
    flexShrink: 0,
    height: "48px",
    padding: `0 ${theme.space[4]}`,
    borderBottom: `1px solid ${ground.seam}`,
    backgroundColor: ground.base,
  }),

  railBrand: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[2],
    color: theme.color.foreground,
    textDecoration: "none",
    fontFamily: "var(--nx-font-family-display)",
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  }),

  railSep: css({
    color: theme.color.mutedForeground,
    opacity: 0.5,
    fontFamily: theme.fontFamily.mono,
  }),

  railProject: css({
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
    color: theme.color.mutedForeground,
  }),

  railSpacer: css({ flex: 1 }),

  phaseChip: css({
    display: "inline-flex",
    alignItems: "center",
    gap: theme.space[2],
    padding: `${theme.space[1]} ${theme.space[2.5]}`,
    borderRadius: theme.radius.full,
    border: `1px solid ${signal.humanEdge}`,
    backgroundColor: signal.humanDim,
    color: signal.humanBright,
    fontFamily: theme.fontFamily.mono,
    fontSize: "10px",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  }),

  phaseDot: css({
    width: "5px",
    height: "5px",
    borderRadius: theme.radius.full,
    backgroundColor: signal.human,
    animation: `${breathe} 2.2s ${theme.easing.standard} infinite`,
  }),

  /* ── Split body ────────────────────────────────────────────────────── */

  body: css({
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
    flex: 1,
    minHeight: 0,
  }),

  pane: css({
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    minWidth: 0,
  }),

  paneLeft: css({ borderRight: `1px solid ${ground.seam}`, backgroundColor: ground.base }),
  paneRight: css({ backgroundColor: ground.panel }),

  paneHead: css({
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: theme.space[2],
    flexShrink: 0,
    height: "38px",
    padding: `0 ${theme.space[4]}`,
    borderBottom: `1px solid ${ground.seam}`,
    overflow: "hidden",
  }),

  paneHeadLabel: eyebrow,

  /** A single pass of cyan across the header while the model is writing. */
  paneHeadScan: css({
    position: "absolute",
    insetBlock: 0,
    insetInline: 0,
    pointerEvents: "none",
    "&::after": {
      content: '""',
      position: "absolute",
      insetBlock: 0,
      width: "45%",
      background: `linear-gradient(90deg, transparent, ${signal.machineDim}, transparent)`,
      animation: `${scan} 2.2s ${theme.easing.standard} infinite`,
    },
  }),

  liveTag: css({
    display: "inline-flex",
    alignItems: "center",
    gap: theme.space[1.5],
    fontFamily: theme.fontFamily.mono,
    fontSize: "10px",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: signal.machineBright,
  }),

  liveTagDot: css({
    width: "5px",
    height: "5px",
    borderRadius: theme.radius.full,
    backgroundColor: signal.machine,
    animation: `${breathe} 1.4s ${theme.easing.standard} infinite`,
  }),

  /* ── Conversation ──────────────────────────────────────────────────── */

  thread: css({
    display: "flex",
    flexDirection: "column",
    gap: theme.space[5],
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: theme.space[5],
  }),

  opening: css({
    margin: "auto",
    maxWidth: "38ch",
    textAlign: "center",
  }),

  openingTitle: css({
    fontFamily: "var(--nx-font-family-display)",
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.medium,
    letterSpacing: "-0.02em",
    color: theme.color.foreground,
  }),

  openingBody: css({
    marginTop: theme.space[2],
    fontSize: theme.fontSize.sm,
    lineHeight: theme.lineHeight.base,
    color: theme.color.mutedForeground,
  }),

  composer: css({
    flexShrink: 0,
    padding: theme.space[4],
    borderTop: `1px solid ${ground.seam}`,
    backgroundColor: ground.base,
  }),

  elicitation: css({
    marginBottom: theme.space[3],
  }),

  /* ── Plan pane ─────────────────────────────────────────────────────── */

  planScroll: css({
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
  }),

  gateBar: css({
    flexShrink: 0,
    borderTop: `1px solid ${ground.seam}`,
    backgroundColor: ground.base,
    padding: theme.space[3],
  }),

  /* Waiting-for-plan state: a spec sheet drawing itself. */
  awaiting: css({
    display: "flex",
    flexDirection: "column",
    gap: theme.space[3],
    padding: theme.space[5],
  }),

  awaitingRow: css({
    height: "9px",
    borderRadius: theme.radius.sm,
    backgroundColor: ground.raised,
    animation: `${breathe} 2s ${theme.easing.standard} infinite`,
  }),

  awaitingNote: css({
    marginTop: theme.space[4],
    fontFamily: theme.fontFamily.mono,
    fontSize: "11px",
    letterSpacing: "0.06em",
    color: theme.color.mutedForeground,
  }),

  readout,
};
