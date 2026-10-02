import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IN_HOUSE_FONT_NAMES, IN_HOUSE_FONT_DIR, inHouseFontFiles, resolveInHouseFont, fontStack, inHouseFontFaceCss, vendorInHouseFonts } from "./fonts.ts";

// Approved 2 Oct 2026: generated apps use NexUI's own fonts only, never Google
// Fonts. The first Ledgerly run's brief asked for Cabinet Grotesk (not
// available anywhere we load from), so every heading fell back to Times New
// Roman.

// 2026-10-02 (Ledgerly benchmark run 3): NexuiSans and NexuiMono are 4 KB
// placeholder files (96 rough glyphs, no font name). Every heading drawn in
// NexuiSans came out garbled. Only real typefaces are offered.
test("the in-house catalogue is the real typefaces only: Inter and JetBrains Mono", () => {
  expect(IN_HOUSE_FONT_NAMES).toEqual(["Inter", "JetBrains Mono"]);
});

test("every font file we ship is a real typeface: a name and at least 200 glyphs", async () => {
  const { execFileSync } = await import("node:child_process");
  for (const file of inHouseFontFiles()) {
    const out = execFileSync("python", ["-c", `from fontTools.ttLib import TTFont; t=TTFont(r"${join(IN_HOUSE_FONT_DIR, file)}"); print(t["maxp"].numGlyphs, "|", t["name"].getDebugName(4))`], { encoding: "utf-8" }).trim();
    const [glyphs, name] = out.split(" | ");
    expect({ file, realTypeface: Number(glyphs) >= 200 && !!name && name !== "None" }).toEqual({ file, realTypeface: true });
  }
});

test("an in-house font is kept; anything else maps to an in-house font", () => {
  expect(resolveInHouseFont("Inter", "body")).toBe("Inter");
  expect(resolveInHouseFont("nexui sans", "display")).toBe("Inter");
  expect(resolveInHouseFont("NexuiMono", "body")).toBe("JetBrains Mono");
  expect(resolveInHouseFont("Cabinet Grotesk", "display")).toBe("Inter");
  expect(resolveInHouseFont("Plus Jakarta Sans", "body")).toBe("Inter");
  expect(resolveInHouseFont("IBM Plex Mono", "body")).toBe("JetBrains Mono");
  expect(resolveInHouseFont("Söhne (fallback: system-ui)", "display")).toBe("Inter");
});

test("every font stack ends in system fonts, which draw the rupee sign the in-house fonts lack", () => {
  expect(fontStack("Inter")).toBe("'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif");
  expect(fontStack("JetBrains Mono")).toBe("'JetBrains Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace");
});

test("@font-face rules point at the app's own /fonts folder, never an outside host", () => {
  const css = inHouseFontFaceCss(["Inter"]);
  expect(css).toContain("font-family: 'Inter'");
  expect(css).toContain("url('/fonts/Inter-SemiBold.woff2') format('woff2')");
  expect(css).not.toContain("JetBrains");
  expect(css).not.toMatch(/https?:\/\//);
});

test("vendoring copies only the used fonts into public/fonts", () => {
  const dir = mkdtempSync(join(tmpdir(), "inhouse-fonts-"));
  try {
    const copied = vendorInHouseFonts(dir, ["Inter"]);
    const files = readdirSync(join(dir, "public", "fonts")).sort();
    expect(files).toEqual(copied.sort());
    expect(files).toContain("Inter-Bold.woff2");
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
