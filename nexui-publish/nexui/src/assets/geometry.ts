// @yugnex/nexui — Icon Geometry
// Hand-authored SVG path data. 24x24 viewBox. Stroke-based (fill:none).
// Render: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
//           <path d={NexuiIcons.check} />
//         </svg>

export const NexuiIcons = {
  // ── Navigation & Actions ─────────────────────────────────────────────────
  arrowLeft:     "M19 12H5M5 12l7-7M5 12l7 7",
  arrowRight:    "M5 12h14M13 5l7 7-7 7",
  arrowUp:       "M12 19V5M5 12l7-7 7 7",
  arrowDown:     "M12 5v14M19 12l-7 7-7-7",
  chevronLeft:   "M15 18l-6-6 6-6",
  chevronRight:  "M9 18l6-6-6-6",
  chevronUp:     "M18 15l-6-6-6 6",
  chevronDown:   "M6 9l6 6 6-6",
  chevronUpDown: "M8 9l4-4 4 4M8 15l4 4 4-4",
  externalLink:  "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3",

  // ── File & Folder ────────────────────────────────────────────────────────
  file:          "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6",
  fileCode:      "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M10 13l-2 2 2 2 M14 13l2 2-2 2",
  fileText:      "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
  folder:        "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
  folderOpen:    "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z M2 10h20",

  // ── Interface ────────────────────────────────────────────────────────────
  home:          "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10",
  menu:          "M3 12h18M3 6h18M3 18h18",
  x:             "M18 6L6 18M6 6l12 12",
  plus:          "M12 5v14M5 12h14",
  minus:         "M5 12h14",
  check:         "M20 6L9 17l-5-5",
  search:        "M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z",
  filter:        "M22 3H2l8 9.46V19l4 2v-8.54z",
  settings:      "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  moreHoriz:     "M5 12h.01M12 12h.01M19 12h.01",
  moreVert:      "M12 5h.01M12 12h.01M12 19h.01",
  copy:          "M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  trash:         "M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2",
  edit:          "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  download:      "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
  upload:        "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12",
  share:         "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8 M16 6l-4-4-4 4 M12 2v13",
  refresh:       "M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15",

  // ── Status & Feedback ────────────────────────────────────────────────────
  info:          "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 8h.01 M12 12v4",
  alertCircle:   "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 8v4 M12 16h.01",
  alertTriangle: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01",
  checkCircle:   "M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4L12 14.01l-3-3",
  loader:        "M12 2v4 M12 18v4 M4.93 4.93l2.83 2.83 M16.24 16.24l2.83 2.83 M2 12h4 M18 12h4 M4.93 19.07l2.83-2.83 M16.24 7.76l2.83-2.83",
  activity:      "M22 12h-4l-3 9L9 3l-3 9H2",

  // ── Communication ────────────────────────────────────────────────────────
  message:       "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  send:          "M22 2L11 13 M22 2L15 22l-4-9-9-4 22-7z",
  bell:          "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0",

  // ── Code & Tech ──────────────────────────────────────────────────────────
  code:          "M16 18l6-6-6-6 M8 6l-6 6 6 6",
  terminal:      "M4 17l6-6-6-6 M12 19h8",
  cpu:           "M18 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z M9 9h6v6H9z M9 1v3 M15 1v3 M9 20v3 M15 20v3 M20 9h3 M20 14h3 M1 9h3 M1 14h3",
  database:      "M12 2C7.58 2 4 3.79 4 6v12c0 2.21 3.58 4 8 4s8-1.79 8-4V6c0-2.21-3.58-4-8-4z M4 12c0 2.21 3.58 4 8 4s8-1.79 8-4 M4 6c0 2.21 3.58 4 8 4s8-1.79 8-4",
  server:        "M22 2H2a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h20a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z M0 14h24v4a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-4z M6 6h.01 M6 18h.01",
  git:           "M18 3a3 3 0 0 1 0 6 3 3 0 0 1-2.83-2H9.83A3 3 0 0 1 4 9a3 3 0 0 1 3-3 3 3 0 0 1 2.83 2h5.34A3 3 0 0 1 18 6z M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M6 9v6",
  gitBranch:     "M6 3v12 M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 9a9 9 0 0 1-9 9",
  gitCommit:     "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M1.05 12H7 M17.01 12H23",
  gitPullRequest: "M18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M13 6h3a2 2 0 0 1 2 2v7 M6 9v12",
  package:       "M16.5 9.4L7.55 4.24 M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 1 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12",
  play:          "M5 3l14 9-14 9V3z",
  stop:          "M18 18H6V6h12z",
  pause:         "M6 19h4V5H6v14zM14 5v14h4V5h-4z",

  // ── Security ─────────────────────────────────────────────────────────────
  // Fixed padlock — corrected from the malformed original
  lock:          "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z M7 11V7a5 5 0 0 1 10 0v4",
  unlock:        "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z M7 11V7a5 5 0 0 1 9.9-1",
  shield:        "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  shieldCheck:   "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4",
  eye:           "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeOff:        "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94 M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19 M1 1l22 22",
  key:           "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",

  // ── User & Social ────────────────────────────────────────────────────────
  user:          "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  users:         "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  userPlus:      "M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M20 8v6 M23 11h-6",

  // ── Layout & Panels ──────────────────────────────────────────────────────
  layout:        "M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z M3 9h18 M9 21V9",
  sidebar:       "M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z M9 3v18",
  grid:          "M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z",
  columns:       "M12 3h9v18h-9z M3 3h7v18H3z",
  maximize:      "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3",
  minimize:      "M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3",

  // ── Charts & Data ────────────────────────────────────────────────────────
  barChart:      "M18 20V10 M12 20V4 M6 20v-6",
  lineChart:     "M3 3v18h18 M3 9l4.5 4.5L12 9l4.5 6L21 9",
  pieChart:      "M21.21 15.89A10 10 0 1 1 8 2.83 M22 12A10 10 0 0 0 12 2v10z",
  trendUp:       "M23 6l-9.5 9.5-5-5L1 18 M17 6h6v6",
  trendDown:     "M23 18l-9.5-9.5-5 5L1 6 M17 18h6v-6",
  zap:           "M13 2L3 14h9l-1 8 10-12h-9l1-8z",

  // ── Misc ─────────────────────────────────────────────────────────────────
  star:          "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z",
  heart:         "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z",
  bookmark:      "M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z",
  tag:           "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z M7 7h.01",
  link:          "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  globe:         "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
  clock:         "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2",
  calendar:      "M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z M16 1v4 M8 1v4 M3 9h18",
  sparkles:      "M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z M19 15l.75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75z M5 3l.5 1.5L7 5l-1.5.5L5 7l-.5-1.5L3 5l1.5-.5z",
} as const;

export type NexuiIconName = keyof typeof NexuiIcons;

/** Renders an SVG string for the given icon. */
export function nexIcon(
  name: NexuiIconName,
  opts: {
    size?:        number;
    strokeWidth?: number;
    color?:       string;
    className?:   string;
    ariaLabel?:   string;
  } = {}
): string {
  const {
    size        = 16,
    strokeWidth = 1.5,
    color       = "currentColor",
    className   = "",
    ariaLabel,
  } = opts;

  const aria = ariaLabel
    ? `role="img" aria-label="${ariaLabel}"`
    : `aria-hidden="true"`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${className ? ` class="${className}"` : ""} ${aria}><path d="${NexuiIcons[name]}"/></svg>`;
}
