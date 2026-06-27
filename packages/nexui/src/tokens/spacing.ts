// @yugnex/nexui — Spacing Scale
// 4px base unit. All values are multiples of 4px.

export const NEXUI_SPACE = {
  0:    "0px",
  px:   "1px",
  0.5:  "2px",
  1:    "4px",
  1.5:  "6px",
  2:    "8px",
  2.5:  "10px",
  3:    "12px",
  3.5:  "14px",
  4:    "16px",
  5:    "20px",
  6:    "24px",
  7:    "28px",
  8:    "32px",
  9:    "36px",
  10:   "40px",
  11:   "44px",
  12:   "48px",
  14:   "56px",
  16:   "64px",
  20:   "80px",
  24:   "96px",
  28:   "112px",
  32:   "128px",
  36:   "144px",
  40:   "160px",
  44:   "176px",
  48:   "192px",
  52:   "208px",
  56:   "224px",
  60:   "240px",
  64:   "256px",
  72:   "288px",
  80:   "320px",
  96:   "384px",
} as const;

export type SpaceKey = keyof typeof NEXUI_SPACE;

// Semantic spacing aliases — what components reference
export const NEXUI_SPACE_SEMANTIC = {
  "component-xs":  NEXUI_SPACE[1],    // 4px — tight internal padding
  "component-sm":  NEXUI_SPACE[2],    // 8px — small component padding
  "component-md":  NEXUI_SPACE[3],    // 12px — standard component padding
  "component-lg":  NEXUI_SPACE[4],    // 16px — large component padding
  "component-xl":  NEXUI_SPACE[6],    // 24px — extra-large component padding

  "layout-xs":     NEXUI_SPACE[4],    // 16px — tight section gap
  "layout-sm":     NEXUI_SPACE[6],    // 24px — small section gap
  "layout-md":     NEXUI_SPACE[8],    // 32px — standard section gap
  "layout-lg":     NEXUI_SPACE[12],   // 48px — large section gap
  "layout-xl":     NEXUI_SPACE[16],   // 64px — page-level gap

  "inline-xs":     NEXUI_SPACE[1],    // 4px — inline element gap
  "inline-sm":     NEXUI_SPACE[2],    // 8px — small inline gap
  "inline-md":     NEXUI_SPACE[3],    // 12px — standard inline gap
  "inline-lg":     NEXUI_SPACE[4],    // 16px — large inline gap

  "icon-sm":       NEXUI_SPACE[4],    // 16px — small icon size
  "icon-md":       NEXUI_SPACE[5],    // 20px — standard icon size
  "icon-lg":       NEXUI_SPACE[6],    // 24px — large icon size

  "radius-none":   "0px",
  "radius-xs":     "2px",
  "radius-sm":     "4px",
  "radius-md":     "6px",
  "radius-lg":     "8px",
  "radius-xl":     "12px",
  "radius-2xl":    "16px",
  "radius-full":   "9999px",

  "border-thin":   "1px",
  "border-medium": "1.5px",
  "border-thick":  "2px",
} as const;
