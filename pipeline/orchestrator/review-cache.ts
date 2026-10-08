// A reviewer that passed on this exact code is not run again (approved by Amit,
// 4 Oct 2026). Ledgerly run 4: a restart re-ran all three reviewers on code
// that had not changed since they passed — about $3 to learn nothing — and a
// fresh roll of a review that is not repeatable (the same code passed one pass
// and failed the next). The cache is keyed to a fingerprint of everything the
// reviewers read, and only a PASS is cached — a failed review is always run again.
//
// 5 Oct 2026 (Ledgerly run 4): after a pass, one builder fix changed ONE file and
// all three reviewers read the whole app again (~$2). A pass now also remembers a
// hash of every file it covered; when the code has changed, the reviewer is asked
// to read only the files that differ from its last pass. A reviewer that never
// passed reads everything.
// Switch off with QA_REVIEW_CACHE_ENABLED=false.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listLabeledFiles, resolveLabeledFile, type LabeledDir } from "../../packages/agent-runtime/src/qa-loop.ts";
import { buildDirFor } from "../../packages/agent-runtime/src/build-dir.ts";

export function isReviewCacheEnabled(): boolean {
  return process.env.QA_REVIEW_CACHE_ENABLED !== "false";
}

/** A hash of each file the reviewers would read, by labeled path. */
export function hashFiles(dirs: LabeledDir[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of listLabeledFiles(dirs).sort()) {
    const abs = resolveLabeledFile(dirs, path);
    let content = "";
    try {
      content = abs ? readFileSync(abs, "utf-8") : "";
    } catch {
      content = "";
    }
    out[path] = createHash("sha256").update(content.replace(/\r\n/g, "\n")).digest("hex").slice(0, 16);
  }
  return out;
}

export function fingerprintOf(files: Record<string, string>): string {
  const h = createHash("sha256");
  for (const path of Object.keys(files).sort()) h.update(path).update("\0").update(files[path]!).update("\0");
  return h.digest("hex").slice(0, 24);
}

/** A hash of everything the reviewers read: changes when any reviewed file changes. */
export function fingerprintCode(dirs: LabeledDir[]): string {
  return fingerprintOf(hashFiles(dirs));
}

/** Files that are new or different compared with an earlier pass. */
export function changedSince(before: Record<string, string>, now: Record<string, string>): string[] {
  return Object.keys(now).filter((path) => before[path] !== now[path]);
}

interface CacheEntry<T> {
  hash: string;
  result: T;
  at: string;
  files?: Record<string, string>;
}

function cacheFile(projectId: string): string {
  return join(buildDirFor(projectId), "review-pass-cache.json");
}

function readAll(projectId: string): Record<string, CacheEntry<unknown>> {
  const file = cacheFile(projectId);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as Record<string, CacheEntry<unknown>>;
  } catch {
    return {};
  }
}

/**
 * Runs `run` unless this reviewer already passed on this exact code. When the code has changed since a
 * pass, `run` receives the files that changed (unless the caller supplied its own list). `fingerprint`
 * may be passed in when the caller already computed it.
 */
export async function withReviewCache<T extends { passed: boolean }>(
  projectId: string,
  reviewer: string,
  dirs: LabeledDir[],
  run: (changedFiles?: string[]) => Promise<T>,
  fingerprint?: string,
  callerChangedFiles?: string[],
): Promise<T> {
  if (!isReviewCacheEnabled()) return run(callerChangedFiles);
  const files = hashFiles(dirs);
  const hash = fingerprint ?? fingerprintOf(files);
  const all = readAll(projectId);
  const hit = all[reviewer] as CacheEntry<T> | undefined;
  if (hit && hit.hash === hash && hit.result?.passed) {
    console.log(`[stage5] ${reviewer}: the code is unchanged since this reviewer last passed it (${hit.at}) — not run again`);
    return hit.result;
  }
  let changed = callerChangedFiles && callerChangedFiles.length > 0 ? callerChangedFiles : undefined;
  if (!changed && hit?.result?.passed && hit.files) {
    const delta = changedSince(hit.files, files);
    if (delta.length > 0) {
      changed = delta;
      console.log(`[stage5] ${reviewer}: passed earlier — reading only the ${delta.length} file(s) changed since: ${delta.slice(0, 6).join(", ")}`);
    }
  }
  const result = await run(changed);
  if (result.passed) {
    try {
      mkdirSync(buildDirFor(projectId), { recursive: true });
      const next = { ...readAll(projectId), [reviewer]: { hash, result, at: new Date().toISOString(), files } };
      writeFileSync(cacheFile(projectId), JSON.stringify(next), "utf-8");
    } catch (err) {
      console.error(`[stage5] could not save the review cache: ${String(err).slice(0, 120)}`);
    }
  }
  return result;
}
