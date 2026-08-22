import { css, keyframes, themeVars as theme } from "@yugnex/core";

/**
 * The YugNex design layer.
 *
 * `@yugnex/core`'s theme covers the semantic palette every registry component
 * reads (background/foreground/border/primary/...). This module is what the
 * theme deliberately does not encode: the product's own signal system, its
 * elevation ramp, and its motion vocabulary.
 *
 * ── The thesis ──────────────────────────────────────────────────────────────
 * This is an instrument, not a dashboard. The visual references are mission
 * control and spectrometry readouts, not SaaS marketing: hairline seams
 * instead of floating cards, elevation carried by value rather than shadow,
 * mono-set numerics, and light used as signal rather than decoration.
 *
 * ── Two-channel signal ──────────────────────────────────────────────────────
 * Exactly two hues carry meaning, and nothing else in the chrome is colored:
 *
 *   AMBER — the human channel. Something is waiting on *you*: a plan to
 *           approve, a change to accept, the primary action on a screen.
 *   CYAN  — the machine channel. Something is happening *now*: an agent
 *           writing a file, a stage running, text streaming in.
 *
 * The payoff is that colour becomes readable at a glance across the whole
 * product — amber means act, cyan means wait — instead of being theming.
 * Semantic success/failure are the only other colours permitted, and they
 * appear on outcomes only, never on chrome.
 */

/* ── Signal ────────────────────────────────────────────────────────────── */

export const signal = {
  /** Human channel: decisions, approvals, primary actions. */
  human: "#FFB020",
  humanBright: "#FFC759",
  humanDim: "rgba(255, 176, 32, 0.10)",
  humanEdge: "rgba(255, 176, 32, 0.28)",

  /** Machine channel: live agent work, streaming, generation. */
  machine: "#22D3EE",
  machineBright: "#67E8F9",
  machineDim: "rgba(34, 211, 238, 0.10)",
  machineEdge: "rgba(34, 211, 238, 0.26)",

  /** Outcomes only — never chrome. */
  ok: "#34D399",
  okDim: "rgba(52, 211, 153, 0.10)",
  fail: "#FB7185",
  failDim: "rgba(251, 113, 133, 0.10)",
} as const;

/**
 * Ground and elevation.
 *
 * Blue-shifted rather than neutral: against a cool near-black the amber
 * channel reads genuinely hot, which a neutral gray flattens. Steps are
 * value-only — a panel is distinguished by its own value and a hairline
 * seam, never by a drop shadow, which is what keeps the surface reading as
 * one machined object instead of a stack of cards.
 */
export const ground = {
  void: "#07090D",
  base: "#0A0D12",
  panel: "#0E1218",
  raised: "#131822",
  overlay: "#181E29",

  seam: "rgba(148, 173, 214, 0.09)",
  seamStrong: "rgba(148, 173, 214, 0.16)",
} as const;

/* ── Motion ────────────────────────────────────────────────────────────── */

/** A single pass of light along an element — an agent is working on this. */
export const scan = keyframes({
  "0%": { transform: "translateX(-100%)" },
  "100%": { transform: "translateX(100%)" },
});

/** Slow luminance breathing for anything live but not progressing visibly. */
export const breathe = keyframes({
  "0%, 100%": { opacity: 0.35 },
  "50%": { opacity: 1 },
});

/** Entry: rises and resolves. Paired with a per-child delay to stagger. */
export const rise = keyframes({
  from: { opacity: 0, transform: "translateY(6px)" },
  to: { opacity: 1, transform: "translateY(0)" },
});

/** A ring pushing outward once — a discrete event landed. */
export const ping = keyframes({
  "0%": { transform: "scale(1)", opacity: 0.55 },
  "70%": { transform: "scale(2.4)", opacity: 0 },
  "100%": { transform: "scale(2.4)", opacity: 0 },
});

/* ── Recipes ───────────────────────────────────────────────────────────── */

/**
 * Mono numerics. Anything countable — paths, ids, durations, token counts,
 * diff stats — is set in mono with tabular figures so columns of digits line
 * up and never reflow as they tick. This is most of what makes the product
 * read as an instrument rather than a web page.
 */
export const readout = css({
  fontFamily: theme.fontFamily.mono,
  fontVariantNumeric: "tabular-nums",
  letterSpacing: theme.letterSpacing.tight,
});

/** Small uppercase section label. */
export const eyebrow = css({
  fontFamily: theme.fontFamily.mono,
  fontSize: "10px",
  fontWeight: theme.fontWeight.medium,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: theme.color.mutedForeground,
});

/** A panel: value + hairline seam. No shadow, no radius soup. */
export const panel = css({
  backgroundColor: ground.panel,
  border: `1px solid ${ground.seam}`,
  borderRadius: theme.radius.md,
});

/** The scanline element itself — position a child with this inside a panel. */
export const scanline = css({
  position: "absolute",
  insetBlock: 0,
  insetInline: 0,
  overflow: "hidden",
  pointerEvents: "none",
  "&::after": {
    content: '""',
    position: "absolute",
    insetBlock: 0,
    width: "40%",
    background: `linear-gradient(90deg, transparent, ${signal.machineDim}, transparent)`,
    animation: `${scan} 2.4s ${theme.easing.standard} infinite`,
  },
});

/**
 * Field grid — a faint engineered lattice behind open canvas. Two 1px
 * gradients rather than an image, so it costs nothing and scales cleanly.
 * Masked to fade out toward the edges so it never reads as a wallpaper.
 */
export const fieldGrid = css({
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  backgroundImage: `linear-gradient(${ground.seam} 1px, transparent 1px), linear-gradient(90deg, ${ground.seam} 1px, transparent 1px)`,
  backgroundSize: "64px 64px",
  maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, #000 30%, transparent 75%)",
  WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, #000 30%, transparent 75%)",
});

/** Per-child stagger delay for a `rise` entry. */
export function riseIn(index: number, step = 45): string {
  return css({
    animation: `${rise} ${theme.duration.slow} ${theme.easing.decelerate} both`,
    animationDelay: `${index * step}ms`,
  });
}
