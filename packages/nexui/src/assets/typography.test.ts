import { test, expect } from "bun:test";
import { nexuiFontFaceBlock, NEXUI_FONT_PATH, NexuiTypographySheet } from "./typography.ts";

// 2026-08-19: real bug found live — the @font-face urls were relative
// ('./fonts/…'). This sheet is injected as an inline <style>, so a relative
// url() resolves against the DOCUMENT, not a stylesheet file: the same font
// 404-ed at "/fonts/NexuiSans-Medium.woff2" on /dashboard and
// "/build/fonts/NexuiSans-Bold.woff2" on /build/:id in one session. Every
// weight fell back to a system face on every page.

test("font urls are absolute, so they do not resolve against the current route", () => {
  const css = nexuiFontFaceBlock();
  const urls = [...css.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]!);

  expect(urls.length).toBe(4);
  for (const u of urls) {
    expect(u.startsWith("/")).toBe(true);
    expect(u.startsWith("./")).toBe(false);
    expect(u.startsWith("../")).toBe(false);
  }
});

test("font urls point at the directory the app actually serves", () => {
  expect(nexuiFontFaceBlock()).toContain(`${NEXUI_FONT_PATH}/NexuiSans-Regular.woff2`);
});

test("a consumer that vendors the fonts elsewhere can supply its own base path", () => {
  const css = nexuiFontFaceBlock("/assets/type");
  expect(css).toContain("url('/assets/type/NexuiMono-Regular.woff2')");
  expect(css).not.toContain("/nexui-fonts/");
});

test("a trailing slash in the base path does not produce a doubled separator", () => {
  expect(nexuiFontFaceBlock("/fonts/")).toContain("url('/fonts/NexuiSans-Bold.woff2')");
  expect(nexuiFontFaceBlock("/fonts/")).not.toContain("//NexuiSans-Bold");
});

test("all four shipped faces are declared", () => {
  const css = nexuiFontFaceBlock();
  for (const f of ["NexuiSans-Regular", "NexuiSans-Medium", "NexuiSans-Bold", "NexuiMono-Regular"]) {
    expect(css).toContain(`${f}.woff2`);
  }
});

test("the injected sheet carries the corrected absolute urls", () => {
  // The sheet is what actually reaches the page, so the regression has to be
  // asserted there and not only on the helper.
  expect(NexuiTypographySheet).toContain("url('/nexui-fonts/NexuiSans-Regular.woff2')");
  expect(NexuiTypographySheet).not.toContain("url('./fonts/");
});
