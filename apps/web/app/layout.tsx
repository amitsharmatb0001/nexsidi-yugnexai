import type { Metadata } from "next";
import type { ReactNode } from "react";
import { StyleRegistry, ThemeProvider } from "@yugnex/core/client";
import { createTheme, NoFoucScript } from "@yugnex/core";
import { ground, signal } from "@/lib/design";
import "./globals.css";

export const metadata: Metadata = {
  title: "YugNex — Autonomous Software Operator",
  description: "Describe your idea. Get a working app.",
};

/**
 * The semantic layer every registry component reads.
 *
 * Values come from `lib/design`, so the theme and the product's own signal
 * system cannot drift apart — `primary` *is* the human channel, and a
 * component reaching for `theme.color.primary` therefore lands on the same
 * amber that means "waiting on you" everywhere else.
 *
 * Both modes resolve to the same values. This is a workspace people sit in
 * for hours; it commits to the dark ground rather than shipping a light
 * theme nobody designed.
 */
const palette = {
  background: ground.base,
  foreground: "#E8EDF7",
  card: ground.panel,
  cardForeground: "#E8EDF7",
  popover: ground.overlay,
  popoverForeground: "#E8EDF7",
  muted: ground.raised,
  mutedForeground: "#7D8899",
  secondary: ground.raised,
  secondaryForeground: "#E8EDF7",
  border: ground.seam,
  input: ground.seamStrong,

  primary: signal.human,
  primaryForeground: "#0A0D12",
  accent: signal.humanDim,
  accentForeground: signal.humanBright,
  ring: signal.human,

  success: signal.ok,
  successForeground: "#07090D",
  warning: signal.human,
  warningForeground: "#07090D",
  destructive: signal.fail,
  destructiveForeground: "#07090D",

  // 0.72 read as clearly-legible background text through the New Project
  // modal's backdrop, confirmed live (reproduced the exact bleed-through
  // the report described) — this dark-on-dark palette needs a much heavier
  // dim before background content is actually obscured, not just tinted.
  overlay: "rgba(5, 6, 9, 0.94)",
};

const yugnexTheme = createTheme({ light: palette, dark: palette });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <NoFoucScript />
      </head>
      <body>
        <StyleRegistry>
          <ThemeProvider theme={yugnexTheme} defaultColorMode="dark">
            {children}
          </ThemeProvider>
        </StyleRegistry>
      </body>
    </html>
  );
}
