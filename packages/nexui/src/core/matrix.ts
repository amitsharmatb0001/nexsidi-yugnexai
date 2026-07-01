// @yugnex/nexui — Layout Matrix
// Encodes layout intent as a composable 32-bit bitmask.
// Bits 0-3: padding · Bits 4-7: flex/display · Bits 8-11: border-radius
// Bits 12-15: gap · Bits 16-19: width · Bits 20-23: overflow
// Compose with bitwise OR: PAD_MD | FLEX_ROW | ALIGN_CENTER | RAD_MD

export const enum LayoutMatrix {
  // Padding (bits 0-3)
  PAD_NONE   = 0x0,
  PAD_XS     = 0x1,   // 0.25rem / 4px
  PAD_SM     = 0x2,   // 0.5rem  / 8px
  PAD_MD     = 0x3,   // 0.75rem / 12px
  PAD_LG     = 0x4,   // 1rem    / 16px
  PAD_XL     = 0x5,   // 1.5rem  / 24px
  PAD_2XL    = 0x6,   // 2rem    / 32px

  // Display / Flex direction (bits 4-7)
  FLEX_ROW   = 0x10,  // display:flex; flex-direction:row
  FLEX_COL   = 0x20,  // display:flex; flex-direction:column
  GRID_2     = 0x30,  // display:grid; grid-template-columns:repeat(2,1fr)
  GRID_3     = 0x40,  // display:grid; grid-template-columns:repeat(3,1fr)
  GRID_4     = 0x50,  // display:grid; grid-template-columns:repeat(4,1fr)

  // Alignment (bits 5-6 override when used with FLEX_*)
  ALIGN_START   = 0x60,  // align-items:flex-start
  ALIGN_CENTER  = 0x70,  // align-items:center
  ALIGN_END     = 0x80,  // align-items:flex-end
  ALIGN_STRETCH = 0x90,  // align-items:stretch

  // Justify content (bits 6-7 secondary)
  JUSTIFY_START  = 0xA0,  // justify-content:flex-start
  JUSTIFY_CENTER = 0xB0,  // justify-content:center
  JUSTIFY_END    = 0xC0,  // justify-content:flex-end
  JUSTIFY_BET    = 0xD0,  // justify-content:space-between
  JUSTIFY_AROUND = 0xE0,  // justify-content:space-around
  JUSTIFY_EVEN   = 0xF0,  // justify-content:space-evenly

  // Border radius (bits 8-11)
  RAD_NONE   = 0x000,
  RAD_XS     = 0x100,  // 2px
  RAD_SM     = 0x200,  // 4px
  RAD_MD     = 0x300,  // 6px
  RAD_LG     = 0x400,  // 8px
  RAD_XL     = 0x500,  // 12px
  RAD_2XL    = 0x600,  // 16px
  RAD_FULL   = 0x700,  // 9999px

  // Gap (bits 12-15)
  GAP_NONE   = 0x0000,
  GAP_XS     = 0x1000,  // 0.25rem / 4px
  GAP_SM     = 0x2000,  // 0.5rem  / 8px
  GAP_MD     = 0x3000,  // 1rem    / 16px
  GAP_LG     = 0x4000,  // 1.5rem  / 24px
  GAP_XL     = 0x5000,  // 2rem    / 32px

  // Width (bits 16-19)
  W_AUTO     = 0x00000,
  W_FULL     = 0x10000,  // width:100%
  W_SCREEN   = 0x20000,  // width:100vw
  W_FIT      = 0x30000,  // width:fit-content
  W_MIN      = 0x40000,  // width:min-content
  W_MAX      = 0x50000,  // width:max-content

  // Overflow (bits 20-23)
  OVERFLOW_VIS    = 0x000000,  // overflow:visible (default)
  OVERFLOW_HIDDEN = 0x100000,  // overflow:hidden
  OVERFLOW_AUTO   = 0x200000,  // overflow:auto
  OVERFLOW_SCROLL = 0x300000,  // overflow:scroll
}

// Maps bitmask bits to CSS strings — used by the compiler
export const MATRIX_PAD_MAP: Record<number, string> = {
  0x1: "padding:0.25rem;",
  0x2: "padding:0.5rem;",
  0x3: "padding:0.75rem;",
  0x4: "padding:1rem;",
  0x5: "padding:1.5rem;",
  0x6: "padding:2rem;",
};

export const MATRIX_DISPLAY_MAP: Record<number, string> = {
  0x10: "display:flex;flex-direction:row;",
  0x20: "display:flex;flex-direction:column;",
  0x30: "display:grid;grid-template-columns:repeat(2,1fr);",
  0x40: "display:grid;grid-template-columns:repeat(3,1fr);",
  0x50: "display:grid;grid-template-columns:repeat(4,1fr);",
  0x60: "align-items:flex-start;",
  0x70: "align-items:center;",
  0x80: "align-items:flex-end;",
  0x90: "align-items:stretch;",
  0xA0: "justify-content:flex-start;",
  0xB0: "justify-content:center;",
  0xC0: "justify-content:flex-end;",
  0xD0: "justify-content:space-between;",
  0xE0: "justify-content:space-around;",
  0xF0: "justify-content:space-evenly;",
};

export const MATRIX_RADIUS_MAP: Record<number, string> = {
  0x100: "border-radius:2px;",
  0x200: "border-radius:4px;",
  0x300: "border-radius:6px;",
  0x400: "border-radius:8px;",
  0x500: "border-radius:12px;",
  0x600: "border-radius:16px;",
  0x700: "border-radius:9999px;",
};

export const MATRIX_GAP_MAP: Record<number, string> = {
  0x1000: "gap:0.25rem;",
  0x2000: "gap:0.5rem;",
  0x3000: "gap:1rem;",
  0x4000: "gap:1.5rem;",
  0x5000: "gap:2rem;",
};

export const MATRIX_WIDTH_MAP: Record<number, string> = {
  0x10000: "width:100%;",
  0x20000: "width:100vw;",
  0x30000: "width:fit-content;",
  0x40000: "width:min-content;",
  0x50000: "width:max-content;",
};

export const MATRIX_OVERFLOW_MAP: Record<number, string> = {
  0x100000: "overflow:hidden;",
  0x200000: "overflow:auto;",
  0x300000: "overflow:scroll;",
};

// Theme token maps — CSS custom property to value
export const NEXUI_THEMES = {
  void: {
    "--nx-bg-void":     "#05070C",
    "--nx-bg-base":     "#0D1117",
    "--nx-bg-surface":  "#161B22",
    "--nx-bg-elevated": "#1C2128",
    "--nx-bg-overlay":  "#21262D",
    "--nx-border":        "rgba(255,255,255,0.08)",
    "--nx-border-strong": "rgba(255,255,255,0.16)",
    "--nx-border-focus":  "rgba(232,144,16,0.60)",
    "--nx-text":          "#E6EDF3",
    "--nx-text-2":        "#8B949E",
    "--nx-text-3":        "#6E7681",
    "--nx-text-4":        "#484F58",
    "--nx-text-inv":      "#05070C",
    "--nx-accent":        "#E89010",
    "--nx-accent-dim":    "rgba(232,144,16,0.09)",
    "--nx-accent-border": "rgba(232,144,16,0.22)",
    "--nx-accent-text":   "#F5B342",
    "--nx-live":          "#0FD4C6",
    "--nx-live-dim":      "rgba(15,212,198,0.09)",
    "--nx-live-border":   "rgba(15,212,198,0.22)",
    "--nx-success":       "#22C55E",
    "--nx-success-dim":   "rgba(34,197,94,0.10)",
    "--nx-error":         "#EF4444",
    "--nx-error-dim":     "rgba(239,68,68,0.10)",
    "--nx-warning":       "#EAB308",
    "--nx-warning-dim":   "rgba(234,179,8,0.10)",
    "--nx-font-sans":     "'NexuiSans','Inter',system-ui,-apple-system,sans-serif",
    "--nx-font-mono":     "'NexuiMono','JetBrains Mono','Fira Code',ui-monospace,monospace",
  },
  terminal: {
    "--nx-bg-void":     "#000000",
    "--nx-bg-base":     "#050505",
    "--nx-bg-surface":  "#0C0E12",
    "--nx-bg-elevated": "#111418",
    "--nx-bg-overlay":  "#161B22",
    "--nx-border":        "#1E293B",
    "--nx-border-strong": "#2D3748",
    "--nx-border-focus":  "rgba(16,185,129,0.60)",
    "--nx-text":          "#10B981",
    "--nx-text-2":        "#6EE7B7",
    "--nx-text-3":        "#34D399",
    "--nx-text-4":        "#065F46",
    "--nx-text-inv":      "#000000",
    "--nx-accent":        "#E89010",
    "--nx-accent-dim":    "rgba(232,144,16,0.09)",
    "--nx-accent-border": "rgba(232,144,16,0.22)",
    "--nx-accent-text":   "#F5B342",
    "--nx-live":          "#10B981",
    "--nx-live-dim":      "rgba(16,185,129,0.09)",
    "--nx-live-border":   "rgba(16,185,129,0.22)",
    "--nx-success":       "#10B981",
    "--nx-success-dim":   "rgba(16,185,129,0.10)",
    "--nx-error":         "#EF4444",
    "--nx-error-dim":     "rgba(239,68,68,0.10)",
    "--nx-warning":       "#EAB308",
    "--nx-warning-dim":   "rgba(234,179,8,0.10)",
    "--nx-font-sans":     "'NexuiMono','JetBrains Mono',ui-monospace,monospace",
    "--nx-font-mono":     "'NexuiMono','JetBrains Mono',ui-monospace,monospace",
  },
} as const;

export type NexuiTheme = keyof typeof NEXUI_THEMES;
