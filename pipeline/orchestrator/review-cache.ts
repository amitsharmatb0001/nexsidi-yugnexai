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
  /** the run that produced this pass read the whole code (not only the files changed since an earlier pass) */
  full?: boolean;
}

// 2026-10-25 (brewline3): after the first full review later rounds read only the changed files, so a defect in a file nobody touched
// surfaced late. Before a build passes, the loop asks every reviewer for one full pass (requestFullReview): that reviewer's next run
// reads all the code, unless its last pass was already a full one on this exact code.
const REVIEWERS = ["navya", "karan", "deepika"];
const fullRequestFile = (projectId: string): string => join(buildDirFor(projectId), "full-review-requested.json");

export function requestFullReview(projectId: string, reviewers: string[] = REVIEWERS): void {
  try {
    mkdirSync(buildDirFor(projectId), { recursive: true });
    writeFileSync(fullRequestFile(projectId), JSON.stringify({ reviewers }), "utf-8");
  } catch (err) {
    console.error(`[stage5] could not record the full review request: ${String(err).slice(0, 120)}`);
  }
}

function pendingFull(projectId: string): string[] {
  try {
    return (JSON.parse(readFileSync(fullRequestFile(projectId), "utf-8")) as { reviewers?: string[] }).reviewers ?? [];
  } catch {
    return [];
  }
}

function clearFull(projectId: string, reviewer: string): void {
  const left = pendingFull(projectId).filter((r) => r !== reviewer);
  try {
    writeFileSync(fullRequestFile(projectId), JSON.stringify({ reviewers: left }), "utf-8");
  } catch {
    // a request that cannot be cleared only makes one more full pass
  }
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
  const wantsFull = pendingFull(projectId).includes(reviewer);
  if (hit && hit.hash === hash && hit.result?.passed && (!wantsFull || hit.full === true)) {
    console.log(`[stage5] ${reviewer}: the code is unchanged since this reviewer last passed it (${hit.at}) — not run again`);
    return hit.result;
  }
  let changed = !wantsFull && callerChangedFiles && callerChangedFiles.length > 0 ? callerChangedFiles : undefined;
  if (!changed && !wantsFull && hit?.result?.passed && hit.files) {
    const delta = changedSince(hit.files, files);
    if (delta.length > 0) {
      changed = delta;
      console.log(`[stage5] ${reviewer}: passed earlier — reading only the ${delta.length} file(s) changed since: ${delta.slice(0, 6).join(", ")}`);
    }
  }
  if (wantsFull) console.log(`[stage5] ${reviewer}: a full review of all the code was requested before the build passes`);
  const result = await run(changed);
  if (wantsFull) clearFull(projectId, reviewer);
  if (result.passed) {
    try {
      mkdirSync(buildDirFor(projectId), { recursive: true });
      const next = { ...readAll(projectId), [reviewer]: { hash, result, at: new Date().toISOString(), files, full: changed === undefined } };
      writeFileSync(cacheFile(projectId), JSON.stringify(next), "utf-8");
    } catch (err) {
      console.error(`[stage5] could not save the review cache: ${String(err).slice(0, 120)}`);
    }
  }
  return result;
}
