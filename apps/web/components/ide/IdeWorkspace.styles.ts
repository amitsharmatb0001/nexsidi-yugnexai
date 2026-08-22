"use client";

import { css, keyframes, themeVars as theme } from "@yugnex/core";
import { breathe, eyebrow, ground, readout, scan, signal } from "@/lib/design";

/**
 * IdeWorkspace — the build-phase view, restructured around a live tool-call
 * stream instead of the older files+tabs+editor shape (still IDE.tsx, kept
 * only until this replaces it everywhere it's used).
 *
 * Structural base: apps/prototype-ui/app/components/IdeWorkspace.tsx — icon
 * rail, collapsible sidebar, center stream with a floating capsule input,
 * right drawer with Plan/Grid modes. What changed in the port: every colour,
 * spacing and motion value now comes from lib/design's two-channel system
 * rather than the prototype's four-hue palette (see AgenticField.tsx's own
 * header comment for why); the emoji icon set is replaced by IdeIcons.tsx;
 * every panel is wired to this project's real data instead of the
 * prototype's static placeholder content.
 */
const fadeUp = keyframes({
  from: { opacity: 0, transform: "translateY(6px)" },
  to: { opacity: 1, transform: "translateY(0)" },
});

export const ws = {
  root: css({
    display: "grid",
    gridTemplateRows: "44px 1fr",
    height: "100dvh",
    backgroundColor: ground.void,
    color: theme.color.foreground,
    overflow: "hidden",
  }),

  /* ── Title bar ─────────────────────────────────────────────────────── */
  titlebar: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[3],
    padding: `0 ${theme.space[3]}`,
    borderBottom: `1px solid ${ground.seam}`,
    backgroundColor: ground.base,
  }),
  brand: css({
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
    flexShrink: 0,
  }),
  projectSep: css({ color: theme.color.mutedForeground, opacity: 0.5, fontFamily: theme.fontFamily.mono }),
  projectName: css({
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
    color: theme.color.mutedForeground,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }),
  titleSpacer: css({ flex: 1 }),

  /* Project switcher — the title bar's project name is a real menu trigger. */
  projectSwitcherBtn: css({
    display: "flex",
    alignItems: "center",
    gap: "4px",
    border: "none",
    background: "transparent",
    color: theme.color.mutedForeground,
    cursor: "pointer",
    padding: `2px ${theme.space[1]}`,
    borderRadius: theme.radius.sm,
    "&:hover": { color: theme.color.foreground, backgroundColor: ground.raised },
  }),
  projectSwitcherMenu: css({ minWidth: "220px", padding: theme.space[1] }),
  projectSwitcherLabel: css({
    padding: `${theme.space[1]} ${theme.space[2]}`,
    fontFamily: theme.fontFamily.mono,
    fontSize: "10px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: theme.color.mutedForeground,
  }),
  projectSwitcherEmpty: css({
    padding: `${theme.space[2]} ${theme.space[2]}`,
    fontSize: "12px",
    color: theme.color.mutedForeground,
  }),
  projectSwitcherItemName: css({
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }),
  projectSwitcherSep: css({
    height: "1px",
    margin: `${theme.space[1]} ${theme.space[1]}`,
    backgroundColor: ground.seam,
  }),

  openBtn: css({
    padding: `${theme.space[1]} ${theme.space[2.5]}`,
    borderRadius: theme.radius.full,
    border: `1px solid ${signal.humanEdge}`,
    backgroundColor: signal.humanDim,
    color: signal.humanBright,
    fontSize: "11px",
    fontWeight: theme.fontWeight.medium,
    textDecoration: "none",
    flexShrink: 0,
  }),

  /* ── Workbench ─────────────────────────────────────────────────────── */
  /* Flex, not grid — the sidebar and drawer are always mounted and their
   * width transitions on open/close, so the center pane (flex: 1) recomputes
   * every frame of that transition and grows into the freed space smoothly.
   * The previous grid conditionally unmounted the <aside>s, so a column
   * simply vanished on the next paint — no transition, and the center's own
   * content (fixed to its own width) didn't reflow into the gap, reading as
   * a jump to "half screen" rather than an adaptive resize. */
  workbench: css({
    position: "relative",
    display: "flex",
    minHeight: 0,
  }),

  /* Icon rail */
  rail: css({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    flexShrink: 0,
    gap: theme.space[2],
    padding: `${theme.space[3]} 0`,
    borderRight: `1px solid ${ground.seam}`,
    backgroundColor: ground.base,
  }),
  railBtn: css({
    display: "grid",
    placeItems: "center",
    width: "30px",
    height: "30px",
    borderRadius: theme.radius.sm,
    border: "1px solid transparent",
    background: "transparent",
    color: theme.color.mutedForeground,
    cursor: "pointer",
    position: "relative",
    transitionProperty: "color, background-color, border-color",
    transitionDuration: theme.duration.fast,
    "&:hover": { color: theme.color.foreground, backgroundColor: ground.raised },
    "&:disabled": { opacity: 0.35, cursor: "default", "&:hover": { backgroundColor: "transparent" } },
  }),
  railBtnActive: css({
    color: signal.machineBright,
    backgroundColor: signal.machineDim,
    borderColor: signal.machineEdge,
    "&:hover": { backgroundColor: signal.machineDim },
  }),
  railDot: css({
    position: "absolute",
    top: "3px",
    right: "3px",
    width: "5px",
    height: "5px",
    borderRadius: theme.radius.full,
    backgroundColor: signal.human,
  }),
  railSpacer: css({ flex: 1 }),

  /* Left sidebar — always mounted; open/closed is a width+opacity transition
   * (see workbench comment above), not a mount/unmount. */
  sidebar: css({
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: ground.base,
    borderRight: `1px solid ${ground.seam}`,
    transitionProperty: "width, opacity, border-color",
    transitionDuration: theme.duration.base,
    transitionTimingFunction: theme.easing.standard,
  }),
  sidebarExpanded: css({ width: "260px", opacity: 1 }),
  sidebarCollapsed: css({ width: "0px", opacity: 0, borderRightColor: "transparent", pointerEvents: "none" }),
  sidebarHead: css({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space[2],
    height: "36px",
    padding: `0 ${theme.space[3]}`,
    borderBottom: `1px solid ${ground.seam}`,
  }),
  sidebarLabel: eyebrow,
  sidebarCount: css({
    fontFamily: theme.fontFamily.mono,
    fontSize: "10px",
    color: theme.color.mutedForeground,
  }),
  filterBox: css({
    margin: theme.space[2],
    padding: `${theme.space[1.5]} ${theme.space[2]}`,
    borderRadius: theme.radius.sm,
    border: `1px solid ${ground.seamStrong}`,
    backgroundColor: ground.void,
    color: theme.color.foreground,
    fontSize: "12px",
    outline: "none",
    "&:focus": { borderColor: signal.machineEdge },
    "&::placeholder": { color: theme.color.mutedForeground },
  }),
  sidebarBody: css({
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: `${theme.space[1]} 0`,
  }),

  treeRow: css({
    display: "flex",
    alignItems: "center",
    gap: "5px",
    width: "100%",
    padding: "3px 8px",
    border: "none",
    background: "transparent",
    color: theme.color.mutedForeground,
    fontSize: "12.5px",
    textAlign: "left",
    cursor: "pointer",
    transitionProperty: "background-color, color",
    transitionDuration: theme.duration.fast,
    "&:hover": { backgroundColor: ground.raised },
  }),
  treeRowSelected: css({ backgroundColor: signal.machineDim, color: theme.color.foreground }),
  treeCaret: css({
    width: "10px",
    fontSize: "9px",
    color: theme.color.mutedForeground,
    transform: "rotate(0deg)",
    transitionProperty: "transform",
    transitionDuration: theme.duration.fast,
    flexShrink: 0,
  }),
  treeCaretOpen: css({ transform: "rotate(90deg)" }),
  treeMark: css({ display: "flex", flexShrink: 0 }),
  treeName: css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }),
  treeNameDir: css({ color: theme.color.foreground, fontWeight: theme.fontWeight.medium }),
  treeNameWriting: css({ color: signal.machineBright }),
  treeNameFresh: css({ color: signal.human }),
  treePip: css({ width: "5px", height: "5px", borderRadius: theme.radius.full, flexShrink: 0 }),
  treePipWriting: css({ backgroundColor: signal.machine, animation: `${breathe} 1.4s ${theme.easing.standard} infinite` }),
  treePipFresh: css({ backgroundColor: signal.human }),

  diffToolbar: css({
    display: "flex",
    gap: theme.space[1],
    padding: `0 ${theme.space[2]} ${theme.space[2]}`,
  }),
  diffToolbarBtn: css({
    flex: 1,
    padding: `${theme.space[1]} 0`,
    borderRadius: theme.radius.sm,
    border: `1px solid ${ground.seamStrong}`,
    background: "transparent",
    color: theme.color.mutedForeground,
    fontSize: "11px",
    cursor: "pointer",
    "&:hover": { color: theme.color.foreground, backgroundColor: ground.raised },
  }),
  diffRow: css({
    display: "flex",
    alignItems: "center",
    gap: "6px",
    width: "100%",
    padding: "4px 8px",
    border: "none",
    background: "transparent",
    color: theme.color.mutedForeground,
    fontSize: "12px",
    textAlign: "left",
    cursor: "pointer",
    "&:hover": { backgroundColor: ground.raised },
  }),
  diffRowSelected: css({ backgroundColor: signal.machineDim }),
  diffBadge: css({
    display: "grid",
    placeItems: "center",
    width: "14px",
    height: "14px",
    borderRadius: "3px",
    fontSize: "9px",
    fontWeight: theme.fontWeight.bold,
    flexShrink: 0,
  }),
  diffBadgeAdd: css({ backgroundColor: signal.okDim, color: signal.ok }),
  diffBadgeDel: css({ backgroundColor: signal.failDim, color: signal.fail }),
  diffBadgeMod: css({ backgroundColor: signal.humanDim, color: signal.human }),
  diffName: css({ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: theme.color.foreground },
  ),
  diffStat: css({ fontFamily: theme.fontFamily.mono, fontSize: "10.5px", display: "flex", gap: "5px", flexShrink: 0 }),
  diffAdd: css({ color: signal.ok }),
  diffDel: css({ color: signal.fail }),

  empty: css({
    padding: `${theme.space[6]} ${theme.space[3]}`,
    fontSize: "12px",
    color: theme.color.mutedForeground,
    lineHeight: theme.lineHeight.base,
  }),

  /* ── Center stream ─────────────────────────────────────────────────── */
  center: css({
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flex: "1 1 auto",
    minWidth: 0,
    minHeight: 0,
    backgroundColor: ground.void,
    overflow: "hidden",
  }),

  centerHead: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[3],
    height: "36px",
    padding: `0 ${theme.space[4]}`,
    borderBottom: `1px solid ${ground.seam}`,
    backgroundColor: ground.base,
    flexShrink: 0,
  }),
  centerHeadTitle: css({
    fontSize: "12.5px",
    fontWeight: theme.fontWeight.medium,
    color: theme.color.foreground,
  }),
  centerHeadSpacer: css({ flex: 1 }),
  liveTag: css({
    display: "inline-flex",
    alignItems: "center",
    gap: theme.space[1.5],
    fontFamily: theme.fontFamily.mono,
    fontSize: "10px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: theme.color.mutedForeground,
  }),
  liveDot: css({ width: "5px", height: "5px", borderRadius: theme.radius.full, backgroundColor: ground.seamStrong }),
  liveDotOn: css({
    backgroundColor: signal.machine,
    animation: `${breathe} 1.6s ${theme.easing.standard} infinite`,
  }),

  drawerToggle: css({
    display: "flex",
    alignItems: "center",
    gap: "5px",
    padding: `4px ${theme.space[2]}`,
    borderRadius: theme.radius.sm,
    border: `1px solid ${ground.seamStrong}`,
    background: "transparent",
    color: theme.color.mutedForeground,
    fontSize: "11px",
    fontWeight: theme.fontWeight.medium,
    cursor: "pointer",
    "&:hover": { color: theme.color.foreground },
  }),
  drawerToggleActive: css({
    borderColor: signal.machineEdge,
    backgroundColor: signal.machineDim,
    color: signal.machineBright,
  }),

  fieldLayer: css({ position: "absolute", inset: 0, opacity: 0.5 }),

  /* File / diff view — replaces the stream when a tab or a changed file is open. */
  tabStrip: css({
    position: "relative",
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    gap: theme.space[2],
    flexShrink: 0,
    paddingLeft: theme.space[2],
    borderBottom: `1px solid ${ground.seam}`,
    backgroundColor: ground.base,
  }),
  streamBackBtn: css({
    flexShrink: 0,
    // marginLeft (not marginRight) — this button is the strip's last child,
    // so margin on its trailing side had nothing to push against and the
    // tabs sat flush against it. Left margin plus its own border reads as a
    // real divider between "open files" and "back to stream".
    marginLeft: theme.space[1],
    padding: `4px ${theme.space[2]}`,
    borderRadius: theme.radius.sm,
    border: `1px solid ${ground.seamStrong}`,
    background: "transparent",
    color: theme.color.mutedForeground,
    fontSize: "11px",
    cursor: "pointer",
    "&:hover": { color: theme.color.foreground },
  }),
  patchPathLabel: css({
    // tabStrip now supplies its own left padding (paddingLeft), so this no
    // longer adds its own — the old value stacked with it, over-indenting.
    padding: `${theme.space[2]} 0`,
    fontFamily: theme.fontFamily.mono,
    fontSize: "12px",
    color: theme.color.foreground,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }),
  fileBody: css({
    position: "relative",
    zIndex: 1,
    flex: 1,
    minHeight: 0,
    overflow: "auto",
  }),

  stream: css({
    position: "relative",
    zIndex: 1,
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: `${theme.space[4]} ${theme.space[5]} ${theme.space[8]}`,
    display: "flex",
    flexDirection: "column",
    gap: theme.space[3],
  }),

  streamRow: css({
    display: "flex",
    gap: theme.space[2.5],
    animation: `${fadeUp} ${theme.duration.base} ${theme.easing.decelerate} both`,
  }),
  streamWho: css({
    flexShrink: 0,
    width: "84px",
    paddingTop: "2px",
    fontFamily: theme.fontFamily.mono,
    fontSize: "10.5px",
    letterSpacing: "0.04em",
    color: theme.color.mutedForeground,
    textAlign: "right",
  }),
  streamWhoLive: css({ color: signal.machineBright }),
  streamBody: css({ flex: 1, minWidth: 0 }),
  streamText: css({
    fontSize: "13px",
    lineHeight: 1.6,
    color: theme.color.foreground,
  }),
  streamTextProblem: css({ color: signal.fail }),
  streamMeta: css({
    marginTop: "2px",
    fontFamily: theme.fontFamily.mono,
    fontSize: "11px",
    color: theme.color.mutedForeground,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }),

  /* Planning-phase messages — same row shape as the build-phase stream
   * (streamRow/streamWho/streamBody), so the two phases read as one
   * continuous surface instead of switching visual language mid-project.
   * No per-side bubble: assistant text sits flush on the background, user
   * text gets a flat quoted block, neither has rounded per-side corners or
   * reversed alignment. */
  planText: css({
    fontSize: "13px",
    lineHeight: 1.6,
    color: theme.color.foreground,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  }),
  planUserText: css({
    fontSize: "13px",
    lineHeight: 1.6,
    color: theme.color.foreground,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    padding: `${theme.space[2]} ${theme.space[3]}`,
    borderRadius: theme.radius.sm,
    backgroundColor: ground.raised,
    borderLeft: `2px solid ${signal.humanEdge}`,
  }),

  streamEmpty: css({
    margin: "auto",
    textAlign: "center",
    maxWidth: "34ch",
  }),
  streamEmptyTitle: css({
    fontFamily: "var(--nx-font-family-display)",
    fontSize: theme.fontSize.base,
    color: theme.color.foreground,
    marginBottom: theme.space[2],
  }),
  streamEmptyBody: css({
    fontSize: "12.5px",
    color: theme.color.mutedForeground,
    lineHeight: theme.lineHeight.base,
  }),

  /* Floating capsule footer */
  capsuleWrap: css({
    position: "relative",
    zIndex: 2,
    flexShrink: 0,
    padding: `0 ${theme.space[4]} ${theme.space[4]}`,
  }),
  gateCard: css({
    marginBottom: theme.space[2],
    padding: theme.space[3],
    borderRadius: theme.radius.md,
    border: `1px solid ${signal.humanEdge}`,
    backgroundColor: signal.humanDim,
  }),
  gateTitle: css({ fontSize: "13px", fontWeight: theme.fontWeight.semibold, color: theme.color.foreground }),
  gateHint: css({ marginTop: "2px", fontSize: "12px", color: theme.color.mutedForeground }),
  gateInput: css({
    width: "100%",
    marginTop: theme.space[2],
    padding: `${theme.space[1.5]} ${theme.space[2]}`,
    borderRadius: theme.radius.sm,
    border: `1px solid ${ground.seamStrong}`,
    backgroundColor: ground.void,
    color: theme.color.foreground,
    fontSize: "12.5px",
    outline: "none",
    "&:focus": { borderColor: signal.human },
  }),
  gateActions: css({ marginTop: theme.space[2], display: "flex", justifyContent: "flex-end" }),

  /* Clarifying-question card — same family as gateCard (a human-decision
   * moment), not a bespoke design: flat surface, amber "waiting on you"
   * accent, machine-cyan for the selected state (the same convention
   * railBtnActive/treeRowSelected already use everywhere else). */
  elicit: css({
    padding: theme.space[3],
    borderRadius: theme.radius.md,
    border: `1px solid ${signal.humanEdge}`,
    backgroundColor: signal.humanDim,
  }),
  elicitLabel: css({
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginBottom: theme.space[2],
    fontFamily: theme.fontFamily.mono,
    fontSize: "10px",
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: signal.humanBright,
  }),
  elicitLabelDot: css({
    width: "5px",
    height: "5px",
    borderRadius: theme.radius.full,
    backgroundColor: signal.human,
    flexShrink: 0,
  }),
  elicitQuestion: css({
    fontSize: "13px",
    fontWeight: theme.fontWeight.medium,
    color: theme.color.foreground,
    lineHeight: theme.lineHeight.base,
    marginBottom: theme.space[2.5],
  }),
  elicitOptions: css({ display: "flex", flexDirection: "column", gap: theme.space[1.5] }),
  elicitOption: css({
    display: "flex",
    alignItems: "flex-start",
    gap: theme.space[2],
    width: "100%",
    padding: `${theme.space[2]} ${theme.space[2.5]}`,
    borderRadius: theme.radius.sm,
    border: `1px solid ${ground.seamStrong}`,
    backgroundColor: ground.raised,
    textAlign: "left",
    cursor: "pointer",
    transitionProperty: "background-color, border-color",
    transitionDuration: theme.duration.fast,
    "&:hover": { borderColor: signal.machineEdge },
  }),
  elicitOptionSelected: css({
    borderColor: signal.machineEdge,
    backgroundColor: signal.machineDim,
  }),
  elicitOptionRecommended: css({ borderColor: signal.humanEdge }),
  elicitOptionBody: css({ flex: 1, minWidth: 0 }),
  elicitOptionTop: css({ display: "flex", alignItems: "center", gap: theme.space[2], flexWrap: "wrap" }),
  elicitOptionLabel: css({ fontSize: "12.5px", fontWeight: theme.fontWeight.medium, color: theme.color.foreground }),
  elicitOptionDesc: css({ marginTop: "2px", fontSize: "11px", color: theme.color.mutedForeground, lineHeight: theme.lineHeight.base }),
  elicitOptionRecTag: css({
    padding: "1px 6px",
    borderRadius: theme.radius.full,
    border: `1px solid ${signal.humanEdge}`,
    backgroundColor: signal.humanDim,
    color: signal.humanBright,
    fontSize: "9px",
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  }),
  elicitCheckbox: css({
    display: "grid",
    placeItems: "center",
    width: "14px",
    height: "14px",
    marginTop: "1px",
    borderRadius: "4px",
    border: `1px solid ${ground.seamStrong}`,
    flexShrink: 0,
  }),
  elicitCheckboxChecked: css({
    borderColor: signal.machineEdge,
    backgroundColor: signal.machine,
    color: ground.void,
    fontSize: "9px",
  }),
  elicitArrow: css({ fontSize: "11px", color: theme.color.mutedForeground, flexShrink: 0, marginTop: "1px" }),
  elicitSubmitRow: css({ marginTop: theme.space[2], display: "flex", justifyContent: "flex-end" }),

  statusLine: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[2],
    padding: `${theme.space[2]} ${theme.space[3]}`,
    borderRadius: theme.radius.md,
    border: `1px solid ${ground.seam}`,
    backgroundColor: ground.panel,
    fontSize: "12px",
    color: theme.color.mutedForeground,
  }),

  /* ── Right drawer ──────────────────────────────────────────────────── */
  /* Always mounted; open/closed is a width+opacity transition, same as the
   * left sidebar above. */
  drawer: css({
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: ground.base,
    borderLeft: `1px solid ${ground.seam}`,
    transitionProperty: "width, opacity, border-color",
    transitionDuration: theme.duration.base,
    transitionTimingFunction: theme.easing.standard,
  }),
  drawerExpanded: css({ width: "380px", opacity: 1 }),
  drawerCollapsed: css({ width: "0px", opacity: 0, borderLeftColor: "transparent", pointerEvents: "none" }),
  drawerHead: css({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: "36px",
    padding: `0 ${theme.space[3]}`,
    borderBottom: `1px solid ${ground.seam}`,
    flexShrink: 0,
  }),
  drawerLabel: eyebrow,
  drawerClose: css({
    display: "grid",
    placeItems: "center",
    width: "22px",
    height: "22px",
    borderRadius: theme.radius.sm,
    border: "none",
    background: "transparent",
    color: theme.color.mutedForeground,
    cursor: "pointer",
    "&:hover": { color: theme.color.foreground, backgroundColor: ground.raised },
  }),
  drawerBody: css({ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }),

  /* ── Dock panels ───────────────────────────────────────────────────── */
  /* Several small, independently collapsible sections stacked in the right
   * column — Plan / Context / Preview / Background tasks / Files changed /
   * Cost — instead of one drawer switching between two fixed modes.
   * Modeled on Claude.ai's own Project sidebar sections, not copied: our
   * own tokens, our own motion, and a maximize control theirs doesn't have. */
  dockPanel: css({
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    borderBottom: `1px solid ${ground.seam}`,
    flexShrink: 0,
    "&:last-of-type": { borderBottom: "none" },
  }),
  dockPanelOpen: css({
    // An open panel is allowed to grow and share the column's free height
    // with whichever other panels are also open — closing one hands its
    // room to the rest instead of leaving a gap.
    flex: "1 1 auto",
  }),
  dockPanelHead: css({
    position: "relative",
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
  }),
  dockPanelHeadBtn: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[2],
    flex: 1,
    minWidth: 0,
    padding: `${theme.space[2]} ${theme.space[3]}`,
    border: "none",
    background: "transparent",
    color: theme.color.foreground,
    cursor: "pointer",
    textAlign: "left",
    "&:hover": { backgroundColor: ground.raised },
  }),
  dockPanelIcon: css({ display: "flex", flexShrink: 0, color: theme.color.mutedForeground }),
  dockPanelLabel: css({
    fontSize: "12.5px",
    fontWeight: theme.fontWeight.medium,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }),
  dockPanelSpacer: css({ flex: 1 }),
  dockPanelChevron: css({
    display: "flex",
    flexShrink: 0,
    color: theme.color.mutedForeground,
    transform: "rotate(-90deg)",
    transitionProperty: "transform",
    transitionDuration: theme.duration.fast,
    transitionTimingFunction: theme.easing.standard,
  }),
  dockPanelChevronOpen: css({ transform: "rotate(0deg)" }),
  dockPanelBadge: css({
    flexShrink: 0,
    width: "6px",
    height: "6px",
    borderRadius: theme.radius.full,
    backgroundColor: signal.human,
  }),
  dockPanelMaxBtn: css({
    position: "absolute",
    right: theme.space[8],
    top: "50%",
    transform: "translateY(-50%)",
    display: "grid",
    placeItems: "center",
    width: "22px",
    height: "22px",
    borderRadius: theme.radius.sm,
    border: "none",
    background: "transparent",
    color: theme.color.mutedForeground,
    cursor: "pointer",
    "&:hover": { color: theme.color.foreground, backgroundColor: ground.raised },
  }),
  dockPanelBody: css({
    flex: 1,
    minHeight: "120px",
    maxHeight: "360px",
    overflow: "auto",
    padding: `0 ${theme.space[3]} ${theme.space[3]}`,
    animation: `${fadeUp} ${theme.duration.fast} ${theme.easing.decelerate} both`,
  }),

  /* Maximize overlay — a panel takes the whole workspace temporarily. */
  maximizeOverlay: css({
    position: "absolute",
    inset: 0,
    zIndex: 30,
    display: "flex",
    flexDirection: "column",
    backgroundColor: ground.base,
    animation: `${fadeUp} ${theme.duration.base} ${theme.easing.decelerate} both`,
  }),
  maximizeOverlayHead: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[2],
    height: "40px",
    flexShrink: 0,
    padding: `0 ${theme.space[4]}`,
    borderBottom: `1px solid ${ground.seam}`,
  }),
  maximizeOverlayBody: css({ flex: 1, minHeight: 0, overflow: "auto", padding: theme.space[4] }),

  /* Context panel */
  contextPanelBody: css({
    display: "flex",
    flexDirection: "column",
    gap: theme.space[2],
  }),
  contextPanelRow: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[2],
  }),
  contextPanelUpload: css({
    display: "flex",
    alignItems: "center",
    gap: "5px",
    padding: `${theme.space[1]} ${theme.space[2]}`,
    borderRadius: theme.radius.sm,
    border: `1px solid ${ground.seamStrong}`,
    background: "transparent",
    color: theme.color.mutedForeground,
    fontSize: "11px",
    cursor: "default",
    opacity: 0.7,
  }),
  contextPanelSoon: css({
    fontSize: "9px",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: theme.color.mutedForeground,
    opacity: 0.8,
  }),
  contextPanelSpacer: css({ flex: 1 }),
  contextPanelError: css({ fontSize: "11px", color: signal.fail }),

  tileEmpty: css({ fontSize: "11px", color: theme.color.mutedForeground, lineHeight: 1.5 }),

  previewFrame: css({ width: "100%", height: "100%", border: "none", borderRadius: theme.radius.sm }),

  readout,
  scanBar: css({
    position: "relative",
    overflow: "hidden",
    "&::after": {
      content: '""',
      position: "absolute",
      insetBlock: 0,
      insetInline: 0,
      pointerEvents: "none",
      background: `linear-gradient(90deg, transparent, ${signal.machineDim}, transparent)`,
      width: "50%",
      animation: `${scan} 2.4s ${theme.easing.standard} infinite`,
    },
  }),
};
