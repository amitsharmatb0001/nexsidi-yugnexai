// Emoji used as UI graphics in a generated frontend (2026-10-22). On the Trailhead Gear Rentals build the product cards
// showed a backpack emoji and a bed emoji as the pictures of the gear, and the booking pages used emoji as icons. It reads
// as a template rather than a real business, and no check looked for it. Like the dead-button check, this is a cheap static
// scan whose findings go to the frontend builder in the same round as the reviewers' findings.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type { Finding } from "./stage4-multi-agent-dev.ts";
import { buildDirFor } from "../../../packages/agent-runtime/src/build-dir.ts";

// Pictographic emoji blocks. Typographic marks (©, ®, ™, ✓, ✔, ✕, ✗, arrows) are outside these ranges or excluded below.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
const TYPOGRAPHIC = /[\u2713-\u2717]/u;

export function findEmojiInUi(relPath: string, source: string): Finding[] {
  const lines: number[] = [];
  source.split("\n").forEach((line, i) => {
    const stripped = line.replace(new RegExp(TYPOGRAPHIC, "gu"), "");
    if (EMOJI.test(stripped)) lines.push(i + 1);
  });
  if (lines.length === 0) return [];
  return [{
    file: relPath,
    issue:
      `[emoji-ui] emoji are used as UI graphics on lines ${lines.join(", ")}. A real product does not use emoji as product ` +
      `images or icons: use a real image (a photo or illustration file under public/), an SVG icon component, or a ` +
      `designed placeholder in the brand colours, and keep text free of emoji.`,
  }];
}

function walk(dir: string): string[] {
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  return names.flatMap((n) => {
    if (["node_modules", ".next", "public", "vendor", "nexui"].includes(n)) return [];
    const full = join(dir, n);
    try {
      if (statSync(full).isDirectory()) return walk(full);
    } catch { return []; }
    return [".tsx", ".jsx"].includes(extname(n)) ? [full] : [];
  });
}

export function scanProjectForEmojiUi(projectId: string): Finding[] {
  const root = buildDirFor(projectId, process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds");
  return walk(join(root, "frontend")).flatMap((full) => {
    try {
      return findEmojiInUi(relative(root, full).split("\\").join("/"), readFileSync(full, "utf-8"));
    } catch {
      return [];
    }
  });
}
