// @yugnex/nexui — Typography Tokens
// Fluid type scale: clamp(minPx, yIntersect + slope*100vw, maxPx)
// Min viewport: 320px. Max viewport: 1440px.

const MIN_VP = 320;
const MAX_VP = 1440;

function fluid(minPx: number, maxPx: number): string {
  const slope = (maxPx - minPx) / (MAX_VP - MIN_VP);
  const y = minPx - slope * MIN_VP;
  const yFixed = parseFloat(y.toFixed(4));
  const slopeFixed = parseFloat((slope * 100).toFixed(4));
  const sign = yFixed >= 0 ? "+" : "-";
  return `clamp(${minPx}px, ${Math.abs(yFixed)}px ${sign} ${slopeFixed}vw, ${maxPx}px)`;
}

// Type scale — based on a modular scale of 1.25 (Major Third)
export const NEXUI_FONT_SIZE = {
  "2xs":  fluid(10, 11),   // micro labels, timestamps
  "xs":   fluid(11, 12),   // captions, helper text
  "sm":   fluid(12, 13),   // secondary body, badge text
  "base": fluid(13, 14),   // primary body
  "md":   fluid(14, 15),   // large body, button labels
  "lg":   fluid(16, 18),   // subheading
  "xl":   fluid(18, 20),   // section heading
  "2xl":  fluid(20, 24),   // page heading
  "3xl":  fluid(24, 30),   // display sm
  "4xl":  fluid(30, 36),   // display md
  "5xl":  fluid(36, 48),   // display lg
  "6xl":  fluid(48, 60),   // hero
  "7xl":  fluid(60, 72),   // mega hero
} as const;

export const NEXUI_LINE_HEIGHT = {
  "none":    "1",
  "tight":   "1.15",
  "snug":    "1.3",
  "normal":  "1.5",
  "relaxed": "1.65",
  "loose":   "1.8",
  "code":    "1.7",
} as const;

export const NEXUI_LETTER_SPACING = {
  "tighter": "-0.04em",
  "tight":   "-0.02em",
  "normal":  "0em",
  "wide":    "0.04em",
  "wider":   "0.08em",
  "widest":  "0.16em",
  "mono":    "0.02em",
  "caps":    "0.06em",
} as const;

export const NEXUI_FONT_WEIGHT = {
  "thin":       "100",
  "extralight": "200",
  "light":      "300",
  "regular":    "400",
  "medium":     "500",
  "semibold":   "600",
  "bold":       "700",
  "extrabold":  "800",
  "black":      "900",
} as const;

// Font family stacks — zero font file dependency (web-safe system stack)
// When NexuiSans/NexuiMono WOFF2 files are available, prepend them first.
export const NEXUI_FONT_FAMILY = {
  "sans": [
    "NexuiSans",           // reserved — provide via @font-face
    "Inter",               // common on modern systems
    "system-ui",
    "-apple-system",
    "BlinkMacSystemFont",
    "Segoe UI",
    "Roboto",
    "Helvetica Neue",
    "Arial",
    "sans-serif",
  ].join(", "),

  "mono": [
    "NexuiMono",           // reserved — provide via @font-face
    "JetBrains Mono",
    "Fira Code",
    "Cascadia Code",
    "SF Mono",
    "ui-monospace",
    "SFMono-Regular",
    "Menlo",
    "Monaco",
    "Consolas",
    "Liberation Mono",
    "Courier New",
    "monospace",
  ].join(", "),

  "display": [
    "NexuiDisplay",        // reserved — provide via @font-face
    "Cal Sans",
    "DM Sans",
    "Inter",
    "system-ui",
    "sans-serif",
  ].join(", "),
} as const;

// Semantic text role presets — map directly to component style objects
export const NEXUI_TEXT_ROLES = {
  "display-lg": {
    fontSize:      NEXUI_FONT_SIZE["5xl"],
    fontWeight:    NEXUI_FONT_WEIGHT["bold"],
    lineHeight:    NEXUI_LINE_HEIGHT["tight"],
    letterSpacing: NEXUI_LETTER_SPACING["tight"],
    fontFamily:    NEXUI_FONT_FAMILY["display"],
  },
  "display-md": {
    fontSize:      NEXUI_FONT_SIZE["4xl"],
    fontWeight:    NEXUI_FONT_WEIGHT["bold"],
    lineHeight:    NEXUI_LINE_HEIGHT["tight"],
    letterSpacing: NEXUI_LETTER_SPACING["tight"],
    fontFamily:    NEXUI_FONT_FAMILY["display"],
  },
  "heading-xl": {
    fontSize:      NEXUI_FONT_SIZE["3xl"],
    fontWeight:    NEXUI_FONT_WEIGHT["semibold"],
    lineHeight:    NEXUI_LINE_HEIGHT["snug"],
    letterSpacing: NEXUI_LETTER_SPACING["tight"],
    fontFamily:    NEXUI_FONT_FAMILY["sans"],
  },
  "heading-lg": {
    fontSize:      NEXUI_FONT_SIZE["2xl"],
    fontWeight:    NEXUI_FONT_WEIGHT["semibold"],
    lineHeight:    NEXUI_LINE_HEIGHT["snug"],
    letterSpacing: NEXUI_LETTER_SPACING["normal"],
    fontFamily:    NEXUI_FONT_FAMILY["sans"],
  },
  "heading-md": {
    fontSize:      NEXUI_FONT_SIZE["xl"],
    fontWeight:    NEXUI_FONT_WEIGHT["semibold"],
    lineHeight:    NEXUI_LINE_HEIGHT["snug"],
    letterSpacing: NEXUI_LETTER_SPACING["normal"],
    fontFamily:    NEXUI_FONT_FAMILY["sans"],
  },
  "heading-sm": {
    fontSize:      NEXUI_FONT_SIZE["lg"],
    fontWeight:    NEXUI_FONT_WEIGHT["medium"],
    lineHeight:    NEXUI_LINE_HEIGHT["normal"],
    letterSpacing: NEXUI_LETTER_SPACING["normal"],
    fontFamily:    NEXUI_FONT_FAMILY["sans"],
  },
  "label-lg": {
    fontSize:      NEXUI_FONT_SIZE["md"],
    fontWeight:    NEXUI_FONT_WEIGHT["medium"],
    lineHeight:    NEXUI_LINE_HEIGHT["normal"],
    letterSpacing: NEXUI_LETTER_SPACING["normal"],
    fontFamily:    NEXUI_FONT_FAMILY["sans"],
  },
  "label-md": {
    fontSize:      NEXUI_FONT_SIZE["base"],
    fontWeight:    NEXUI_FONT_WEIGHT["medium"],
    lineHeight:    NEXUI_LINE_HEIGHT["normal"],
    letterSpacing: NEXUI_LETTER_SPACING["normal"],
    fontFamily:    NEXUI_FONT_FAMILY["sans"],
  },
  "label-sm": {
    fontSize:      NEXUI_FONT_SIZE["sm"],
    fontWeight:    NEXUI_FONT_WEIGHT["medium"],
    lineHeight:    NEXUI_LINE_HEIGHT["normal"],
    letterSpacing: NEXUI_LETTER_SPACING["wide"],
    fontFamily:    NEXUI_FONT_FAMILY["sans"],
  },
  "label-caps": {
    fontSize:      NEXUI_FONT_SIZE["xs"],
    fontWeight:    NEXUI_FONT_WEIGHT["semibold"],
    lineHeight:    NEXUI_LINE_HEIGHT["normal"],
    letterSpacing: NEXUI_LETTER_SPACING["caps"],
    fontFamily:    NEXUI_FONT_FAMILY["sans"],
    textTransform: "uppercase" as const,
  },
  "body-lg": {
    fontSize:      NEXUI_FONT_SIZE["md"],
    fontWeight:    NEXUI_FONT_WEIGHT["regular"],
    lineHeight:    NEXUI_LINE_HEIGHT["relaxed"],
    letterSpacing: NEXUI_LETTER_SPACING["normal"],
    fontFamily:    NEXUI_FONT_FAMILY["sans"],
  },
  "body-md": {
    fontSize:      NEXUI_FONT_SIZE["base"],
    fontWeight:    NEXUI_FONT_WEIGHT["regular"],
    lineHeight:    NEXUI_LINE_HEIGHT["relaxed"],
    letterSpacing: NEXUI_LETTER_SPACING["normal"],
    fontFamily:    NEXUI_FONT_FAMILY["sans"],
  },
  "body-sm": {
    fontSize:      NEXUI_FONT_SIZE["sm"],
    fontWeight:    NEXUI_FONT_WEIGHT["regular"],
    lineHeight:    NEXUI_LINE_HEIGHT["normal"],
    letterSpacing: NEXUI_LETTER_SPACING["normal"],
    fontFamily:    NEXUI_FONT_FAMILY["sans"],
  },
  "caption": {
    fontSize:      NEXUI_FONT_SIZE["xs"],
    fontWeight:    NEXUI_FONT_WEIGHT["regular"],
    lineHeight:    NEXUI_LINE_HEIGHT["normal"],
    letterSpacing: NEXUI_LETTER_SPACING["normal"],
    fontFamily:    NEXUI_FONT_FAMILY["sans"],
  },
  "code-base": {
    fontSize:      NEXUI_FONT_SIZE["sm"],
    fontWeight:    NEXUI_FONT_WEIGHT["regular"],
    lineHeight:    NEXUI_LINE_HEIGHT["code"],
    letterSpacing: NEXUI_LETTER_SPACING["mono"],
    fontFamily:    NEXUI_FONT_FAMILY["mono"],
  },
  "code-sm": {
    fontSize:      NEXUI_FONT_SIZE["xs"],
    fontWeight:    NEXUI_FONT_WEIGHT["regular"],
    lineHeight:    NEXUI_LINE_HEIGHT["code"],
    letterSpacing: NEXUI_LETTER_SPACING["mono"],
    fontFamily:    NEXUI_FONT_FAMILY["mono"],
  },
} as const;
