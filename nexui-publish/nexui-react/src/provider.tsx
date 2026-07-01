"use client";
// @yugnex/nexui-react — NexuiProvider
// Wraps your Next.js app. Initializes the Web Component engine client-side.
// SSR-safe: the engine call is gated behind useEffect (browser-only).
//
// Usage in app/layout.tsx:
//   import { NexuiProvider } from "@yugnex/nexui-react";
//   export default function RootLayout({ children }) {
//     return <html><body><NexuiProvider theme="void">{children}</NexuiProvider></body></html>;
//   }

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";

export type NexuiTheme = "void" | "terminal";

interface NexuiContextValue {
  theme:     NexuiTheme;
  setTheme:  (t: NexuiTheme) => void;
  ready:     boolean;
}

const NexuiContext = createContext<NexuiContextValue>({
  theme:    "void",
  setTheme: () => {},
  ready:    false,
});

export function useNexui() {
  return useContext(NexuiContext);
}

interface NexuiProviderProps {
  children:      ReactNode;
  theme?:        NexuiTheme;
  onThemeChange?: (t: NexuiTheme) => void;
}

export function NexuiProvider({ children, theme: initialTheme = "void", onThemeChange }: NexuiProviderProps) {
  const [theme, setThemeState] = useState<NexuiTheme>(initialTheme);
  const [ready, setReady]      = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { initializeNexuiEngine } = await import("@yugnex/nexui");
      await initializeNexuiEngine(theme);
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      const { setNexuiTheme } = await import("@yugnex/nexui");
      setNexuiTheme(theme);
    })();
  }, [theme, ready]);

  // Listen for programmatic theme changes from outside React
  useEffect(() => {
    const handler = (e: Event) => {
      const t = (e as CustomEvent<{ theme: NexuiTheme }>).detail.theme;
      setThemeState(t);
      onThemeChange?.(t);
    };
    window.addEventListener("nexui:theme-change", handler);
    return () => window.removeEventListener("nexui:theme-change", handler);
  }, [onThemeChange]);

  const setTheme = useCallback((t: NexuiTheme) => {
    setThemeState(t);
    onThemeChange?.(t);
  }, [onThemeChange]);

  return (
    <NexuiContext.Provider value={{ theme, setTheme, ready }}>
      {children}
    </NexuiContext.Provider>
  );
}
