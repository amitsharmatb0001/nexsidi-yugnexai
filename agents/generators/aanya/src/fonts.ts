// In-house fonts for generated apps — NexUI's own fonts, never Google Fonts
// (approved 2 Oct 2026). The first Ledgerly run's design brief asked for
// Cabinet Grotesk, which nothing we load from serves, so every heading fell
// back to Times New Roman. A brief may now only name these families; anything
// else maps to the closest one, and the font files are copied into the app
// (public/fonts) with their @font-face rules.
//
// None of these fonts contain the rupee sign (they are basic Latin subsets),
// so every stack ends in system fonts; browsers draw the missing glyph from
// those automatically.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

interface InHouseFont {
  family: string;
  kind: "sans" | "mono";
  files: Array<{ weight: number; file: string }>;
}

const IN_HOUSE_FONTS: InHouseFont[] = [
  { family: "NexuiSans", kind: "sans", files: [
    { weight: 400, file: "NexuiSans-Regular.woff2" },
    { weight: 500, file: "NexuiSans-Medium.woff2" },
    { weight: 700, file: "NexuiSans-Bold.woff2" },
  ] },
  { family: "Inter", kind: "sans", files: [
    { weight: 400, file: "Inter-Regular.woff2" },
    { weight: 500, file: "Inter-Medium.woff2" },
    { weight: 600, file: "Inter-SemiBold.woff2" },
    { weight: 700, file: "Inter-Bold.woff2" },
    { weight: 800, file: "Inter-ExtraBold.woff2" },
  ] },
  { family: "JetBrains Mono", kind: "mono", files: [
    { weight: 400, file: "JetBrainsMono-Regular.woff2" },
    { weight: 500, file: "JetBrainsMono-Medium.woff2" },
  ] },
  { family: "NexuiMono", kind: "mono", files: [
    { weight: 400, file: "NexuiMono-Regular.woff2" },
  ] },
];

export const IN_HOUSE_FONT_NAMES = IN_HOUSE_FONTS.map((f) => f.family);

// Repo copy of NexUI's fonts (nexui-publish/nexui/fonts, tracked in git).
export const IN_HOUSE_FONT_DIR = join(import.meta.dir, "..", "..", "..", "..", "nexui-publish", "nexui", "fonts");

const SANS_FALLBACK = ["system-ui", "-apple-system", "'Segoe UI'", "Roboto", "'Noto Sans'", "sans-serif"];
const MONO_FALLBACK = ["ui-monospace", "'Cascadia Mono'", "Consolas", "monospace"];

const normalise = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The in-house family to use for a requested font in a given slot. */
export function resolveInHouseFont(requested: string, slot: "display" | "body"): string {
  // "Charter (fallback: Georgia, serif)" → "Charter"
  const name = requested.replace(/\s*\(fallback:[^)]*\)\s*$/i, "").trim();
  const exact = IN_HOUSE_FONTS.find((f) => normalise(f.family) === normalise(name));
  if (exact) return exact.family;
  if (/mono|code|courier/i.test(name)) return "JetBrains Mono";
  return slot === "display" ? "NexuiSans" : "Inter";
}

function fontFor(family: string): InHouseFont {
  const font = IN_HOUSE_FONTS.find((f) => f.family === family);
  if (!font) throw new Error(`Not an in-house font: ${family}`);
  return font;
}

/** CSS font-family value: the in-house family, then system fonts. */
export function fontStack(family: string): string {
  const font = fontFor(family);
  return [`'${font.family}'`, ...(font.kind === "mono" ? MONO_FALLBACK : SANS_FALLBACK)].join(", ");
}

/** @font-face rules for the given families, served from the app's /fonts. */
export function inHouseFontFaceCss(families: string[]): string {
  return [...new Set(families)].map(fontFor).flatMap((font) => font.files.map((f) => `@font-face {
  font-family: '${font.family}';
  font-style: normal;
  font-weight: ${f.weight};
  font-display: swap;
  src: url('/fonts/${f.file}') format('woff2');
}`)).join("\n") + "\n";
}

/** Copies the given families' files into <app>/public/fonts; returns the file names. */
export function vendorInHouseFonts(appDir: string, families: string[], sourceDir: string = IN_HOUSE_FONT_DIR): string[] {
  const target = join(appDir, "public", "fonts");
  mkdirSync(target, { recursive: true });
  const copied: string[] = [];
  for (const font of [...new Set(families)].map(fontFor)) {
    for (const { file } of font.files) {
      const from = join(sourceDir, file);
      if (!existsSync(from)) throw new Error(`In-house font file missing: ${from}`);
      copyFileSync(from, join(target, file));
      copied.push(file);
    }
  }
  return copied;
}
