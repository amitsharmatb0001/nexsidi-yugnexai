// @yugnex/nexui — Shadow / Elevation System
// Two rulesets: void (dark UI shadows use color + opacity) and terminal.

export const NEXUI_SHADOWS_VOID = {
  // Flat — no elevation
  "none":   "none",

  // Subtle — cards, inline elements on same surface
  "xs":     "0 1px 2px rgba(0,0,0,0.40)",

  // Low — floating buttons, popover triggers
  "sm":     "0 1px 3px rgba(0,0,0,0.50), 0 1px 2px rgba(0,0,0,0.30)",

  // Standard — cards, panels
  "md":     "0 4px 6px rgba(0,0,0,0.40), 0 2px 4px rgba(0,0,0,0.30)",

  // Elevated — dropdowns, date pickers
  "lg":     "0 10px 15px rgba(0,0,0,0.50), 0 4px 6px rgba(0,0,0,0.30)",

  // High — modals, dialogs
  "xl":     "0 20px 25px rgba(0,0,0,0.55), 0 8px 10px rgba(0,0,0,0.30)",

  // Overlay — full-screen drawers, command palette
  "2xl":    "0 25px 50px rgba(0,0,0,0.65)",

  // Accent glow — focused inputs, highlighted cards
  "glow-accent":   "0 0 0 3px rgba(232,144,16,0.30), 0 0 16px rgba(232,144,16,0.12)",
  "glow-live":     "0 0 0 3px rgba(15,212,198,0.25), 0 0 16px rgba(15,212,198,0.10)",
  "glow-success":  "0 0 0 3px rgba(34,197,94,0.25), 0 0 12px rgba(34,197,94,0.08)",
  "glow-error":    "0 0 0 3px rgba(239,68,68,0.30), 0 0 12px rgba(239,68,68,0.10)",

  // Focus ring — keyboard nav, ARIA
  "focus":         "0 0 0 2px #0D1117, 0 0 0 4px rgba(232,144,16,0.60)",

  // Inset — pressed states, sunken containers
  "inner":         "inset 0 2px 4px rgba(0,0,0,0.40)",
  "inner-strong":  "inset 0 2px 8px rgba(0,0,0,0.60)",
} as const;

export const NEXUI_SHADOWS_TERMINAL = {
  "none":   "none",
  "xs":     "0 1px 2px rgba(0,0,0,0.70)",
  "sm":     "0 1px 3px rgba(0,0,0,0.80), 0 1px 2px rgba(0,0,0,0.50)",
  "md":     "0 4px 6px rgba(0,0,0,0.70), 0 2px 4px rgba(0,0,0,0.50)",
  "lg":     "0 10px 15px rgba(0,0,0,0.80), 0 4px 6px rgba(0,0,0,0.50)",
  "xl":     "0 20px 25px rgba(0,0,0,0.85), 0 8px 10px rgba(0,0,0,0.50)",
  "2xl":    "0 25px 50px rgba(0,0,0,0.90)",

  "glow-accent":   "0 0 0 3px rgba(232,144,16,0.30), 0 0 16px rgba(232,144,16,0.12)",
  "glow-live":     "0 0 0 3px rgba(16,185,129,0.30), 0 0 16px rgba(16,185,129,0.12)",
  "glow-success":  "0 0 0 3px rgba(16,185,129,0.30), 0 0 12px rgba(16,185,129,0.10)",
  "glow-error":    "0 0 0 3px rgba(239,68,68,0.35), 0 0 12px rgba(239,68,68,0.12)",
  "focus":         "0 0 0 2px #000000, 0 0 0 4px rgba(16,185,129,0.60)",
  "inner":         "inset 0 2px 4px rgba(0,0,0,0.70)",
  "inner-strong":  "inset 0 2px 8px rgba(0,0,0,0.90)",
} as const;

export type ShadowKey = keyof typeof NEXUI_SHADOWS_VOID;
