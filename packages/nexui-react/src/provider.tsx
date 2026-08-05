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
  // 2026-08-06: real bug found live — a generated project's own
  // theme-overrides.css (correct colors/fonts derived from Vanya's design
  // brief) never actually applied, because initializeNexuiEngine injects the
  // named theme's own <style> tag into document.head at RUNTIME (this
  // effect, on mount), which always lands later in the DOM than any
  // statically-imported stylesheet and wins the cascade regardless of
  // import order. customTokens bakes a project's overrides into that SAME
  // injected style block instead — see compiler.ts's mountGlobalTheme.
  customTokens?: Record<string, string>;
  onThemeChange?: (t: NexuiTheme) => void;
}

export function NexuiProvider({ children, theme: initialTheme = "void", customTokens, onThemeChange }: NexuiProviderProps) {
  const [theme, setThemeState] = useState<NexuiTheme>(initialTheme);
  const [ready, setReady]      = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { initializeNexuiEngine } = await import("@yugnex/nexui");
      await initializeNexuiEngine(theme, customTokens);
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
    // customTokens intentionally excluded from deps: it's a static,
    // per-project design brief baked in at generation time, not runtime
    // state — re-running full engine init on every render would be wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      const { setNexuiTheme } = await import("@yugnex/nexui");
      setNexuiTheme(theme, customTokens);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
