// @yugnex/nexui — Typography Asset
// Exports a complete CSS text block ready for injection via <style>.
// Includes: @font-face stubs, fluid type scale custom properties,
// and base reset for typographic elements.
// Inject once per page: document.head.appendChild(<style>NexuiTypographySheet</style>)

import { NEXUI_FONT_SIZE, NEXUI_FONT_FAMILY, NEXUI_LINE_HEIGHT } from "../tokens/type";
import { NEXUI_KEYFRAMES } from "../tokens/motion";

// @font-face declarations pointing to the in-house WOFF2 files in /fonts/.
// Consumers must serve the /fonts/ directory as static assets.
// Next.js: copy packages/nexui/fonts/ to public/nexui-fonts/ and update the paths below,
//   OR use the path helper: import { NEXUI_FONT_PATH } from "@yugnex/nexui/assets/typography"
// The fonts/ directory is in the @yugnex/nexui package root (published with "files").
const FONT_FACE_BLOCK = `
@font-face {
  font-family: 'NexuiSans';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('./fonts/NexuiSans-Regular.woff2') format('woff2');
}
@font-face {
  font-family: 'NexuiSans';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('./fonts/NexuiSans-Medium.woff2') format('woff2');
}
@font-face {
  font-family: 'NexuiSans';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('./fonts/NexuiSans-Bold.woff2') format('woff2');
}
@font-face {
  font-family: 'NexuiMono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('./fonts/NexuiMono-Regular.woff2') format('woff2');
}
`.trim();

// Fluid type custom properties on :root
const FLUID_VARS_BLOCK = `:root {
  --nx-fs-2xs:  ${NEXUI_FONT_SIZE["2xs"]};
  --nx-fs-xs:   ${NEXUI_FONT_SIZE["xs"]};
  --nx-fs-sm:   ${NEXUI_FONT_SIZE["sm"]};
  --nx-fs-base: ${NEXUI_FONT_SIZE["base"]};
  --nx-fs-md:   ${NEXUI_FONT_SIZE["md"]};
  --nx-fs-lg:   ${NEXUI_FONT_SIZE["lg"]};
  --nx-fs-xl:   ${NEXUI_FONT_SIZE["xl"]};
  --nx-fs-2xl:  ${NEXUI_FONT_SIZE["2xl"]};
  --nx-fs-3xl:  ${NEXUI_FONT_SIZE["3xl"]};
  --nx-fs-4xl:  ${NEXUI_FONT_SIZE["4xl"]};
  --nx-fs-5xl:  ${NEXUI_FONT_SIZE["5xl"]};
  --nx-fs-6xl:  ${NEXUI_FONT_SIZE["6xl"]};
  --nx-fs-7xl:  ${NEXUI_FONT_SIZE["7xl"]};

  --nx-ff-sans:    ${NEXUI_FONT_FAMILY.sans};
  --nx-ff-mono:    ${NEXUI_FONT_FAMILY.mono};
  --nx-ff-display: ${NEXUI_FONT_FAMILY.display};

  --nx-lh-tight:   ${NEXUI_LINE_HEIGHT.tight};
  --nx-lh-normal:  ${NEXUI_LINE_HEIGHT.normal};
  --nx-lh-relaxed: ${NEXUI_LINE_HEIGHT.relaxed};
  --nx-lh-code:    ${NEXUI_LINE_HEIGHT.code};
}`;

// Base typographic reset
const TYPE_RESET_BLOCK = `
*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  -webkit-text-size-adjust: 100%;
  tab-size: 2;
  font-feature-settings: "kern" 1, "liga" 1, "calt" 1;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  margin: 0;
  font-family: var(--nx-ff-sans, ${NEXUI_FONT_FAMILY.sans});
  font-size: var(--nx-fs-base);
  line-height: ${NEXUI_LINE_HEIGHT.relaxed};
  color: var(--nx-text, #E6EDF3);
  background-color: var(--nx-bg-base, #0D1117);
}

code, kbd, samp, pre {
  font-family: var(--nx-ff-mono, ${NEXUI_FONT_FAMILY.mono});
  font-size: 0.9em;
}

h1, h2, h3, h4, h5, h6 {
  margin: 0;
  font-family: var(--nx-ff-display, ${NEXUI_FONT_FAMILY.display});
  line-height: ${NEXUI_LINE_HEIGHT.tight};
  color: var(--nx-text, #E6EDF3);
}

h1 { font-size: var(--nx-fs-4xl); font-weight: 700; }
h2 { font-size: var(--nx-fs-3xl); font-weight: 700; }
h3 { font-size: var(--nx-fs-2xl); font-weight: 600; }
h4 { font-size: var(--nx-fs-xl);  font-weight: 600; }
h5 { font-size: var(--nx-fs-lg);  font-weight: 600; }
h6 { font-size: var(--nx-fs-md);  font-weight: 500; }

p {
  margin: 0;
  line-height: ${NEXUI_LINE_HEIGHT.relaxed};
}

a {
  color: var(--nx-accent-text, #F5B342);
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
}

strong, b { font-weight: 600; }
em, i     { font-style: italic; }

small { font-size: var(--nx-fs-xs); }

pre {
  margin: 0;
  overflow-x: auto;
  tab-size: 2;
}

/* Scrollbar styling */
::-webkit-scrollbar        { width: 6px; height: 6px; }
::-webkit-scrollbar-track  { background: transparent; }
::-webkit-scrollbar-thumb  { background: rgba(255,255,255,0.12); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.20); }

/* Focus visible ring (keyboard nav) */
:focus-visible {
  outline: 2px solid var(--nx-accent, #E89010);
  outline-offset: 2px;
}
:focus:not(:focus-visible) {
  outline: none;
}

/* Selection */
::selection {
  background: rgba(232,144,16,0.25);
  color: var(--nx-text, #E6EDF3);
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`.trim();

// All blocks composed into a single injectable string
export const NexuiTypographySheet: string =
  [FONT_FACE_BLOCK, FLUID_VARS_BLOCK, TYPE_RESET_BLOCK, NEXUI_KEYFRAMES].join("\n\n");

// Fluid type calculation exposed for custom use
export function fluidType(minPx: number, maxPx: number, minVp = 320, maxVp = 1440): string {
  const slope = (maxPx - minPx) / (maxVp - minVp);
  const y = minPx - slope * minVp;
  const yFixed = parseFloat(y.toFixed(4));
  const slopeFixed = parseFloat((slope * 100).toFixed(4));
  const sign = yFixed >= 0 ? "+" : "-";
  return `clamp(${minPx}px, ${Math.abs(yFixed)}px ${sign} ${slopeFixed}vw, ${maxPx}px)`;
}
