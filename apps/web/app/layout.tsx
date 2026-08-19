import type { Metadata } from "next";
import type { ReactNode } from "react";
import { StyleRegistry, ThemeProvider } from "@yugnex/core/client";
import { createTheme, NoFoucScript } from "@yugnex/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "YugNex — Autonomous Software Operator",
  description: "Describe your idea. Get a working app.",
};

/**
 * The YugNex palette, as semantic theme tokens rather than another set of
 * hand-rolled custom properties.
 *
 * This is the same engine Aanya generates every app against (@yugnex/core),
 * so the platform and the apps it produces share one styling system instead
 * of the platform running on an older wrapper library while the generated
 * apps run on the current one.
 *
 * The product commits to a dark surface — it is a workspace people sit in
 * for long stretches — so both modes resolve to the same values rather than
 * shipping a light theme nobody designed.
 */
const yugnexPalette = {
  background:          "#0A0A0B",
  foreground:          "#F4F4F6",
  card:                "#101012",
  cardForeground:      "#F4F4F6",
  popover:             "#16161A",
  popoverForeground:   "#F4F4F6",
  border:              "#1C1C21",
  input:               "#1C1C21",
  muted:               "#16161A",
  mutedForeground:     "#96969E",
  secondary:           "#16161A",
  secondaryForeground: "#F4F4F6",
  primary:             "#FF9F0A",
  primaryForeground:   "#0A0A0B",
  ring:                "#FF9F0A",
};

const yugnexTheme = createTheme({ light: yugnexPalette, dark: yugnexPalette });

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
