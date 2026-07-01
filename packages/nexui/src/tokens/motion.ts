// @yugnex/nexui — Motion Tokens
// Easing curves + durations. Matches native platform conventions.

export const NEXUI_EASING = {
  // Standard — element moves between two screen states
  standard:        "cubic-bezier(0.2, 0, 0, 1)",
  // Decelerate — element enters the screen (decelerates to rest)
  decelerate:      "cubic-bezier(0, 0, 0.2, 1)",
  // Accelerate — element leaves the screen (accelerates to exit)
  accelerate:      "cubic-bezier(0.3, 0, 1, 1)",
  // Linear — progress bars, loaders
  linear:          "linear",
  // Spring — interactive, snap, bouncy (for emphasis)
  spring:          "cubic-bezier(0.34, 1.56, 0.64, 1)",
  // Sharp — micro-interactions (toggles, chips)
  sharp:           "cubic-bezier(0.4, 0, 0.6, 1)",
} as const;

export const NEXUI_DURATION = {
  // Micro — icon state change, badge pulse
  50:   "50ms",
  // Fast — tooltip show/hide, focus ring
  100:  "100ms",
  // Quick — button feedback, checkbox
  150:  "150ms",
  // Standard — panel collapse, menu open
  200:  "200ms",
  // Smooth — drawer, modal, tab transitions
  300:  "300ms",
  // Deliberate — page-level transitions
  400:  "400ms",
  // Slow — complex choreography
  500:  "500ms",
  // Elaborate — data visualization entry
  700:  "700ms",
  // Cinematic — splash, hero
  1000: "1000ms",
} as const;

// Semantic transition presets — use these in components
export const NEXUI_TRANSITION = {
  "instant":    `all ${NEXUI_DURATION[50]}  ${NEXUI_EASING.sharp}`,
  "fast":       `all ${NEXUI_DURATION[100]} ${NEXUI_EASING.standard}`,
  "base":       `all ${NEXUI_DURATION[200]} ${NEXUI_EASING.standard}`,
  "smooth":     `all ${NEXUI_DURATION[300]} ${NEXUI_EASING.decelerate}`,
  "slow":       `all ${NEXUI_DURATION[500]} ${NEXUI_EASING.decelerate}`,
  "none":       "none",

  // Specific property transitions (better performance than `all`)
  "colors":     `color ${NEXUI_DURATION[150]} ${NEXUI_EASING.standard}, background-color ${NEXUI_DURATION[150]} ${NEXUI_EASING.standard}, border-color ${NEXUI_DURATION[150]} ${NEXUI_EASING.standard}, fill ${NEXUI_DURATION[150]} ${NEXUI_EASING.standard}, stroke ${NEXUI_DURATION[150]} ${NEXUI_EASING.standard}`,
  "opacity":    `opacity ${NEXUI_DURATION[200]} ${NEXUI_EASING.standard}`,
  "transform":  `transform ${NEXUI_DURATION[200]} ${NEXUI_EASING.standard}`,
  "ring":       `box-shadow ${NEXUI_DURATION[150]} ${NEXUI_EASING.standard}`,
  "slide-in":   `transform ${NEXUI_DURATION[300]} ${NEXUI_EASING.decelerate}, opacity ${NEXUI_DURATION[300]} ${NEXUI_EASING.decelerate}`,
  "slide-out":  `transform ${NEXUI_DURATION[200]} ${NEXUI_EASING.accelerate}, opacity ${NEXUI_DURATION[200]} ${NEXUI_EASING.accelerate}`,
  "scale":      `transform ${NEXUI_DURATION[200]} ${NEXUI_EASING.spring}`,
  "ring-score": `stroke-dashoffset ${NEXUI_DURATION[700]} ${NEXUI_EASING.decelerate}`,
} as const;

// Keyframe definitions — inject once per page via NexuiTypographySheet or initializeNexuiEngine
export const NEXUI_KEYFRAMES = `
@keyframes nx-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes nx-fade-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}
@keyframes nx-slide-up {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes nx-slide-down {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes nx-scale-in {
  from { opacity: 0; transform: scale(0.95); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes nx-spin {
  to { transform: rotate(360deg); }
}
@keyframes nx-pulse-ring {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}
@keyframes nx-shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}
@keyframes nx-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}
`;
