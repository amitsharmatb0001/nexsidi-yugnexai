import type { ReactNode } from "react";
import { StyleRegistry, ThemeProvider } from "@yugnex/core/client";
import { createTheme, NoFoucScript } from "@yugnex/core";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import "./globals.css";

export const metadata = {
  title: "Brewline",
  description: "Brewline is a mobile-friendly pre-order platform for a single-location neighborhood coffee shop where customers can browse the menu of drinks and pastries with prices, create an account, select items and a pickup time for in-store payment at pickup, and track their orders on a dedicated My Orders page. Baristas and staff manage incoming pre-orders in real time through a built-in Staff Dashboard and update menu items or out-of-stock availability via a Staff Menu Manager. Visual direction: warm, simple, cozy coffee shop aesthetic optimized for mobile screens, featuring soft oat cream #FAF6F0 backgrounds, warm alabaster #F3ECE1 cards, espresso brown #2C1E18 typography, roasted caramel #C87D55 and terracotta #D46A4E accents, Fraunces display headings paired with DM Sans body text, and tactile card-based layouts with no cold corporate styling or purple gradients.",
};

const projectTheme = createTheme({
  "light": {
    "background": "#FAF6F0",
    "foreground": "#2C1E18",
    "card": "#F3ECE1",
    "cardForeground": "#2C1E18",
    "popover": "#F3ECE1",
    "popoverForeground": "#2C1E18",
    "border": "#D8D5CC",
    "input": "#D8D5CC",
    "muted": "#F3ECE1",
    "mutedForeground": "#2C1E18",
    "secondary": "#C87D55",
    "secondaryForeground": "#FAF6F0",
    "primary": "#D46A4E",
    "primaryForeground": "#FAF6F0",
    "ring": "#D46A4E"
  },
  "dark": {
    "background": "#FAF6F0",
    "foreground": "#2C1E18",
    "card": "#F3ECE1",
    "cardForeground": "#2C1E18",
    "popover": "#F3ECE1",
    "popoverForeground": "#2C1E18",
    "border": "#D8D5CC",
    "input": "#D8D5CC",
    "muted": "#F3ECE1",
    "mutedForeground": "#2C1E18",
    "secondary": "#C87D55",
    "secondaryForeground": "#FAF6F0",
    "primary": "#D46A4E",
    "primaryForeground": "#FAF6F0",
    "ring": "#D46A4E"
  }
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <NoFoucScript />
      </head>
      <body>
        <StyleRegistry>
          <ThemeProvider theme={projectTheme} defaultColorMode="light">
            <Header />
            {children}
            <Footer />
          </ThemeProvider>
        </StyleRegistry>
      </body>
    </html>
  );
}
