// Who an Express Build app was copied from, and the names it inherited.
// Kept in one file beside the builds, never inside an app: what a customer receives must not say, or hint, that it
// started from another app. The names matter because a clone of a clone still carries its source's own earlier name.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Lineage {
  clonedFrom: string;
  // Every name the source went by before its current one, oldest first, ending with the source's own name.
  priorNames: string[];
}

const FILE = ".lineage.json";

function readAll(baseDir: string): Record<string, Lineage> {
  const path = join(baseDir, FILE);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, Lineage>) : {};
  } catch {
    return {};
  }
}

export function lineageOf(baseDir: string, projectId: string): Lineage | null {
  const entry = readAll(baseDir)[projectId];
  return entry && typeof entry.clonedFrom === "string" && Array.isArray(entry.priorNames) ? entry : null;
}

export function isClone(baseDir: string, projectId: string): boolean {
  return lineageOf(baseDir, projectId) !== null;
}

export function recordLineage(baseDir: string, projectId: string, lineage: Lineage): void {
  const all = readAll(baseDir);
  all[projectId] = lineage;
  writeFileSync(join(baseDir, FILE), JSON.stringify(all, null, 2), "utf-8");
}
