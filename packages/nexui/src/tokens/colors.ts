// @yugnex/nexui — Sovereign Color System
// Zero external dependencies. All values hand-authored.

export const NEXUI_PALETTE = {
  void: {
    0:   "#000000",
    50:  "#05070C",
    100: "#0A0D14",
    200: "#0D1117",
    300: "#161B22",
    400: "#1C2128",
    500: "#21262D",
    600: "#30363D",
    700: "#3D444D",
    800: "#484F58",
    900: "#6E7681",
    950: "#8B949E",
  },
  amber: {
    50:  "#FFF8E7",
    100: "#FDECC8",
    200: "#F9D07A",
    300: "#F5B342",
    400: "#E89010",
    500: "#C97A0E",
    600: "#A3630B",
    700: "#7D4D09",
    800: "#573606",
    900: "#3A2304",
  },
  teal: {
    50:  "#E6FFFE",
    100: "#CCFFFE",
    200: "#99FFFD",
    300: "#4DFCF7",
    400: "#0FD4C6",
    500: "#0EB5A9",
    600: "#0B8A81",
    700: "#086059",
    800: "#053D38",
    900: "#021F1C",
  },
  green: {
    50:  "#F0FDF4",
    100: "#DCFCE7",
    200: "#BBF7D0",
    300: "#86EFAC",
    400: "#4ADE80",
    500: "#22C55E",
    600: "#16A34A",
    700: "#15803D",
    800: "#166534",
    900: "#14532D",
  },
  red: {
    50:  "#FEF2F2",
    100: "#FEE2E2",
    200: "#FECACA",
    300: "#FCA5A5",
    400: "#F87171",
    500: "#EF4444",
    600: "#DC2626",
    700: "#B91C1C",
    800: "#991B1B",
    900: "#7F1D1D",
  },
  yellow: {
    400: "#FACC15",
    500: "#EAB308",
    600: "#CA8A04",
  },
} as const;

// Semantic layer — what components reference, never raw palette values
export const NEXUI_SEMANTIC_VOID = {
  // Surfaces (ground → highest elevation)
  "bg-void":     NEXUI_PALETTE.void[50],
  "bg-base":     NEXUI_PALETTE.void[200],
  "bg-surface":  NEXUI_PALETTE.void[300],
  "bg-elevated": NEXUI_PALETTE.void[400],
  "bg-overlay":  NEXUI_PALETTE.void[500],

  // Borders
  "border":        "rgba(255,255,255,0.08)",
  "border-strong": "rgba(255,255,255,0.16)",
  "border-focus":  "rgba(232,144,16,0.60)",

  // Text hierarchy
  "text-primary":   "#E6EDF3",
  "text-secondary": NEXUI_PALETTE.void[950],
  "text-dim":       NEXUI_PALETTE.void[900],
  "text-ghost":     NEXUI_PALETTE.void[800],
  "text-inverse":   NEXUI_PALETTE.void[50],

  // Accent (amber — primary brand)
  "accent":        NEXUI_PALETTE.amber[400],
  "accent-dim":    "rgba(232,144,16,0.09)",
  "accent-border": "rgba(232,144,16,0.22)",
  "accent-text":   NEXUI_PALETTE.amber[300],

  // Live / activity (teal)
  "live":        NEXUI_PALETTE.teal[400],
  "live-dim":    "rgba(15,212,198,0.09)",
  "live-border": "rgba(15,212,198,0.22)",

  // Status
  "success":       NEXUI_PALETTE.green[500],
  "success-dim":   "rgba(34,197,94,0.10)",
  "error":         NEXUI_PALETTE.red[500],
  "error-dim":     "rgba(239,68,68,0.10)",
  "warning":       NEXUI_PALETTE.yellow[500],
  "warning-dim":   "rgba(234,179,8,0.10)",
} as const;

export const NEXUI_SEMANTIC_TERMINAL = {
  "bg-void":     "#000000",
  "bg-base":     "#050505",
  "bg-surface":  "#0C0E12",
  "bg-elevated": "#111418",
  "bg-overlay":  "#161B22",

  "border":        "#1E293B",
  "border-strong": "#2D3748",
  "border-focus":  "rgba(16,185,129,0.60)",

  "text-primary":   "#10B981",
  "text-secondary": "#6EE7B7",
  "text-dim":       "#34D399",
  "text-ghost":     "#065F46",
  "text-inverse":   "#000000",

  "accent":        NEXUI_PALETTE.amber[400],
  "accent-dim":    "rgba(232,144,16,0.09)",
  "accent-border": "rgba(232,144,16,0.22)",
  "accent-text":   NEXUI_PALETTE.amber[300],

  "live":        "#10B981",
  "live-dim":    "rgba(16,185,129,0.09)",
  "live-border": "rgba(16,185,129,0.22)",

  "success":       "#10B981",
  "success-dim":   "rgba(16,185,129,0.10)",
  "error":         NEXUI_PALETTE.red[500],
  "error-dim":     "rgba(239,68,68,0.10)",
  "warning":       NEXUI_PALETTE.yellow[500],
  "warning-dim":   "rgba(234,179,8,0.10)",
} as const;

export type NexuiSemanticToken = keyof typeof NEXUI_SEMANTIC_VOID;
