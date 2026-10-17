// Components a copied app inherited but no page renders (a section removed in an earlier version, for example).
// They ship as dead weight and make a removed section's links look valid. Conservative on purpose: a file goes only
// when nothing reaches it through imports AND its name appears nowhere else in the app's source.
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { reachableFiles } from "./anchor-check.ts";

const SOURCE_DIRS = ["app", "components", "lib", "content", "hooks", "utils", "src"];
const SOURCE_EXT = /\.(tsx?|jsx?|mjs)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", "vendor", "dist"]);
// The UI kit and its parts are used by name from anywhere; leaving unused kit files is harmless.
const KEPT_DIRS = ["components/nexui", "components/ui"];

function readSources(frontendDir: string): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (!SKIP_DIRS.has(entry)) walk(full);
      } else if (SOURCE_EXT.test(entry)) {
        files.push({ path: relative(frontendDir, full).split("\\").join("/"), content: readFileSync(full, "utf-8") });
      }
    }
  };
  for (const d of SOURCE_DIRS) if (existsSync(join(frontendDir, d))) walk(join(frontendDir, d));
  return files;
}

/** Removes unused component files from a frontend folder. Returns the removed paths, relative to it. */
export function pruneUnusedComponents(frontendDir: string): string[] {
  if (!existsSync(join(frontendDir, "app"))) return [];
  const files = readSources(frontendDir);
  const reachable = reachableFiles(files);
  const removed: string[] = [];
  for (const f of files) {
    if (!f.path.startsWith("components/") || reachable.has(f.path)) continue;
    if (KEPT_DIRS.some((d) => f.path.startsWith(`${d}/`))) continue;
    const stem = f.path.split("/").pop()!.replace(SOURCE_EXT, "");
    if (stem === "index" || stem.length < 3) continue;
    const nameUsedElsewhere = files.some((other) => other.path !== f.path && other.content.includes(stem));
    if (nameUsedElsewhere) continue;
    try {
      unlinkSync(join(frontendDir, f.path));
      removed.push(f.path);
    } catch {
      /* an unused file is harmless */
    }
  }
  return removed.sort();
}
