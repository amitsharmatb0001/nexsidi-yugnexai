import { test, expect } from "bun:test";
import { nexui_compiler } from "./compiler.ts";
import { NEXUI_THEMES } from "./matrix.ts";

// 2026-08-06: real bug found live (project 09bf2f89ca43, and earlier
// verify361300) — a generated project's own theme-overrides.css (correct
// colors derived from Vanya's design brief) never actually applied. Root
// cause: mountGlobalTheme injects a <style id="yugnex-nexui-theme"> tag into
// document.head at RUNTIME, on NexuiProvider's mount — which always lands
// LATER in the DOM than any statically-imported stylesheet, and same-
// specificity CSS rules that appear later in the document always win
// regardless of import order. Confirmed live via getComputedStyle on a
// deployed site: the source CSS file had the exact right values; only what
// actually rendered was wrong. getThemeCSS's `overrides` param bakes a
// project's tokens into the SAME injected style block instead of a
// separate stylesheet that can never win the cascade fight.
test("getThemeCSS with no overrides returns exactly the named theme's own tokens", () => {
  const css = nexui_compiler.getThemeCSS("void");
  expect(css).toContain(`--nx-bg-base:${NEXUI_THEMES.void["--nx-bg-base"]};`);
  expect(css).toContain(`--nx-accent:${NEXUI_THEMES.void["--nx-accent"]};`);
});

test("getThemeCSS overrides win over the base theme's own values for the same key", () => {
  const css = nexui_compiler.getThemeCSS("void", ":root", { "--nx-bg-base": "#0B132B", "--nx-accent": "#F59E0B" });
  expect(css).toContain("--nx-bg-base:#0B132B;");
  expect(css).toContain("--nx-accent:#F59E0B;");
  // The base theme's own value for these keys must NOT also appear —
  // confirms override, not just append.
  expect(css).not.toContain(`--nx-bg-base:${NEXUI_THEMES.void["--nx-bg-base"]};`);
});

test("getThemeCSS with overrides still includes every base token NOT overridden", () => {
  const css = nexui_compiler.getThemeCSS("void", ":root", { "--nx-accent": "#F59E0B" });
  // --nx-text wasn't overridden — the base theme's value must survive.
  expect(css).toContain(`--nx-text:${NEXUI_THEMES.void["--nx-text"]};`);
});

test("getThemeCSS respects a custom selector for shadow-DOM injection", () => {
  const css = nexui_compiler.getThemeCSS("void", ":host", { "--nx-accent": "#F59E0B" });
  expect(css.startsWith(":host{")).toBe(true);
});

test("getThemeCSS with an empty overrides object behaves identically to no overrides", () => {
  expect(nexui_compiler.getThemeCSS("void", ":root", {})).toBe(nexui_compiler.getThemeCSS("void"));
});
