import { test, expect } from "bun:test";
import { join } from "node:path";
import {
  hexHue,
  hueDistance,
  pickDistinctAccent,
  shiftThemeAccent,
  applyThemeVariation,
  CLONE_ACCENT_PALETTE,
} from "./clone-theme.ts";

// ── hexHue / hueDistance (pure color math) ───────────────────────────────
test("hexHue reads the correct hue for known primary colors", () => {
  expect(hexHue("#FF0000")).toBeCloseTo(0, 0);
  expect(hexHue("#00FF00")).toBeCloseTo(120, 0);
  expect(hexHue("#0000FF")).toBeCloseTo(240, 0);
});

test("hueDistance wraps around the color circle instead of measuring the long way", () => {
  expect(hueDistance(10, 350)).toBeCloseTo(20, 0); // 10 and 350 are 20deg apart around the wheel, not 340
  expect(hueDistance(0, 180)).toBeCloseTo(180, 0);
});

// ── pickDistinctAccent ────────────────────────────────────────────────────
test("pickDistinctAccent never returns the exact source color, even when the source IS a palette entry", () => {
  for (const source of CLONE_ACCENT_PALETTE) {
    const picked = pickDistinctAccent(source, "some-seed");
    expect(picked.toLowerCase()).not.toBe(source.toLowerCase());
  }
});

test("pickDistinctAccent is deterministic — same source and seed always pick the same color", () => {
  const a = pickDistinctAccent("#FF3B00", "clone-abc123");
  const b = pickDistinctAccent("#FF3B00", "clone-abc123");
  expect(a).toBe(b);
});

test("pickDistinctAccent picks different colors for different seeds against the same source", () => {
  const results = new Set(
    ["seed-1", "seed-2", "seed-3", "seed-4", "seed-5", "seed-6"].map((s) => pickDistinctAccent("#FF3B00", s)),
  );
  expect(results.size).toBeGreaterThan(1);
});

// ── shiftThemeAccent (pure file-content transform) ───────────────────────
const REAL_LAYOUT_SHAPE = `import type { ReactNode } from "react";
import { StyleRegistry, ThemeProvider } from "@yugnex/core/client";
import { createTheme, NoFoucScript } from "@yugnex/core";
import "./globals.css";

export const metadata = {
  title: "Gatherly",
  description: "A marketplace for creators.",
};

const projectTheme = createTheme({
  "light": {
    "background": "#0D0D0E",
    "foreground": "#F4F4F5",
    "card": "#0D0D0E",
    "cardForeground": "#F4F4F5",
    "popover": "#0D0D0E",
    "popoverForeground": "#F4F4F5",
    "border": "#27272A",
    "input": "#27272A",
    "muted": "#27272A",
    "mutedForeground": "#F4F4F5",
    "secondary": "#27272A",
    "secondaryForeground": "#F4F4F5",
    "primary": "#FF3B00",
    "primaryForeground": "#ffffff",
    "ring": "#FF3B00"
  },
  "dark": {
    "background": "#0D0D0E",
    "foreground": "#F4F4F5",
    "card": "#0D0D0E",
    "cardForeground": "#F4F4F5",
    "popover": "#0D0D0E",
    "popoverForeground": "#F4F4F5",
    "border": "#27272A",
    "input": "#27272A",
    "muted": "#27272A",
    "mutedForeground": "#F4F4F5",
    "secondary": "#27272A",
    "secondaryForeground": "#F4F4F5",
    "primary": "#FF3B00",
    "primaryForeground": "#ffffff",
    "ring": "#FF3B00"
  }
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return null;
}
`;

test("shiftThemeAccent changes primary+ring in BOTH light and dark blocks, recomputes primaryForeground for contrast", () => {
  const result = shiftThemeAccent(REAL_LAYOUT_SHAPE, "#2563EB");
  expect(result).not.toBeNull();
  expect((result!.match(/"primary": "#2563EB"/g) ?? []).length).toBe(2);
  expect((result!.match(/"ring": "#2563EB"/g) ?? []).length).toBe(2);
  // #2563EB is a dark-ish blue — contrastColor picks white text against it
  expect((result!.match(/"primaryForeground": "#ffffff"/g) ?? []).length).toBe(2);
});

test("shiftThemeAccent leaves background, foreground, and border completely untouched", () => {
  const result = shiftThemeAccent(REAL_LAYOUT_SHAPE, "#2563EB")!;
  expect(result).toContain('"background": "#0D0D0E"');
  expect(result).toContain('"foreground": "#F4F4F5"');
  expect(result).toContain('"border": "#27272A"');
});

test("shiftThemeAccent leaves every other line of the file (imports, metadata, component body) byte-identical", () => {
  const result = shiftThemeAccent(REAL_LAYOUT_SHAPE, "#2563EB")!;
  expect(result).toContain('import { createTheme, NoFoucScript } from "@yugnex/core";');
  expect(result).toContain('title: "Gatherly"');
  expect(result).toContain("export default function RootLayout");
});

test("shiftThemeAccent returns null (not a throw) when the file has no createTheme() call — the older nexui-react projects", () => {
  const oldSystemLayout = `import { NexuiProvider } from "@yugnex/nexui-react";\nexport default function RootLayout() { return null; }\n`;
  expect(shiftThemeAccent(oldSystemLayout, "#2563EB")).toBeNull();
});

test("shiftThemeAccent returns null when the createTheme() block isn't valid JSON rather than crashing", () => {
  const malformed = `const projectTheme = createTheme({ light: notEvenJson });`;
  expect(shiftThemeAccent(malformed, "#2563EB")).toBeNull();
});

// ── applyThemeVariation (I/O wrapper, fake fs via DI) ────────────────────
function makeFakeFs(files: Record<string, string>) {
  const writes: Record<string, string> = {};
  return {
    files,
    writes,
    existsFn: (p: string) => p in files,
    readFn: (p: string) => {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p]!;
    },
    writeFn: (p: string, c: string) => {
      writes[p] = c;
    },
  };
}

test("applyThemeVariation picks a distinct accent and writes it back to layout.tsx", () => {
  const buildDir = join("E:", "tmp", "nexsidi-builds", "clone1");
  const layoutPath = join(buildDir, "frontend", "app", "layout.tsx");
  const fakeFs = makeFakeFs({ [layoutPath]: REAL_LAYOUT_SHAPE });

  const result = applyThemeVariation(buildDir, "clone1", fakeFs);

  expect(result.applied).toBe(true);
  expect(result.newAccent).toBeDefined();
  expect(result.newAccent!.toLowerCase()).not.toBe("#ff3b00");
  expect(fakeFs.writes[layoutPath]).toContain(`"primary": "${result.newAccent}"`);
});

test("applyThemeVariation reports applied:false without throwing when layout.tsx doesn't exist", () => {
  const fakeFs = makeFakeFs({});
  const result = applyThemeVariation("E:/tmp/nexsidi-builds/clone2", "clone2", fakeFs);
  expect(result.applied).toBe(false);
  expect(result.reason).toBeDefined();
});

test("applyThemeVariation reports applied:false without throwing on an old-system project with no createTheme()", () => {
  const buildDir = join("E:", "tmp", "nexsidi-builds", "clone3");
  const layoutPath = join(buildDir, "frontend", "app", "layout.tsx");
  const fakeFs = makeFakeFs({ [layoutPath]: `import { NexuiProvider } from "@yugnex/nexui-react";\n` });

  const result = applyThemeVariation(buildDir, "clone3", fakeFs);
  expect(result.applied).toBe(false);
  expect(result.reason).toContain("createTheme()");
});
