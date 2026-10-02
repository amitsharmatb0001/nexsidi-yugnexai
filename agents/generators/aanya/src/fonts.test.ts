import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IN_HOUSE_FONT_NAMES, resolveInHouseFont, fontStack, inHouseFontFaceCss, vendorInHouseFonts } from "./fonts.ts";

// Approved 2 Oct 2026: generated apps use NexUI's own fonts only, never Google
// Fonts. The first Ledgerly run's brief asked for Cabinet Grotesk (not
// available anywhere we load from), so every heading fell back to Times New
// Roman.

test("the in-house catalogue is NexUI's own fonts", () => {
  expect(IN_HOUSE_FONT_NAMES).toEqual(["NexuiSans", "Inter", "JetBrains Mono", "NexuiMono"]);
});

test("an in-house font is kept; anything else maps to an in-house font", () => {
  expect(resolveInHouseFont("Inter", "body")).toBe("Inter");
  expect(resolveInHouseFont("nexui sans", "display")).toBe("NexuiSans");
  expect(resolveInHouseFont("Cabinet Grotesk", "display")).toBe("NexuiSans");
  expect(resolveInHouseFont("Plus Jakarta Sans", "body")).toBe("Inter");
  expect(resolveInHouseFont("IBM Plex Mono", "body")).toBe("JetBrains Mono");
  expect(resolveInHouseFont("Söhne (fallback: system-ui)", "display")).toBe("NexuiSans");
});

test("every font stack ends in system fonts, which draw the rupee sign the in-house fonts lack", () => {
  expect(fontStack("Inter")).toBe("'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif");
  expect(fontStack("JetBrains Mono")).toBe("'JetBrains Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace");
});

test("@font-face rules point at the app's own /fonts folder, never an outside host", () => {
  const css = inHouseFontFaceCss(["Inter", "NexuiSans"]);
  expect(css).toContain("font-family: 'Inter'");
  expect(css).toContain("url('/fonts/Inter-SemiBold.woff2') format('woff2')");
  expect(css).toContain("font-family: 'NexuiSans'");
  expect(css).not.toContain("JetBrains");
  expect(css).not.toMatch(/https?:\/\//);
});

test("vendoring copies only the used fonts into public/fonts", () => {
  const dir = mkdtempSync(join(tmpdir(), "inhouse-fonts-"));
  try {
    const copied = vendorInHouseFonts(dir, ["NexuiSans", "Inter"]);
    const files = readdirSync(join(dir, "public", "fonts")).sort();
    expect(files).toEqual(copied.sort());
    expect(files).toContain("NexuiSans-Bold.woff2");
    expect(files).toContain("Inter-Regular.woff2");
    expect(files.some((f) => f.startsWith("JetBrains"))).toBe(false);
    expect(existsSync(join(dir, "public", "fonts", "Inter-Regular.woff2"))).toBe(true);
    expect(readFileSync(join(dir, "public", "fonts", "Inter-Regular.woff2")).length).toBeGreaterThan(1000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Aanya's skill tells her to use the font variables and never an outside font", () => {
  const doctrine = readFileSync(new URL("../../../../packages/agent-runtime/skills/aanya/00-identity-and-visual-doctrine.md", import.meta.url), "utf-8");
  expect(doctrine).toContain("var(--font-display)");
  expect(doctrine).toContain("never link Google Fonts");
  expect(doctrine).not.toMatch(/Avoid the default\s+stacks \(Inter/);
});
