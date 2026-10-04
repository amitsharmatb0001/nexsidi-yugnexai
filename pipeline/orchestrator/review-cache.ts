// A reviewer that passed on this exact code is not run again (approved by Amit,
// 4 Oct 2026). Ledgerly run 4: a restart re-ran all three reviewers on code
// that had not changed since they passed — about $3 to learn nothing — and a
// fresh roll of a review that is not repeatable (the same code passed one pass
// and failed the next). The cache is keyed to a fingerprint of everything the
// reviewers read; any change to that code runs the reviewer again, and only a
// PASS is cached — a failed review is always run again.
// Switch off with QA_REVIEW_CACHE_ENABLED=false.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listLabeledFiles, resolveLabeledFile, type LabeledDir } from "../../packages/agent-runtime/src/qa-loop.ts";

export function isReviewCacheEnabled(): boolean {
  return process.env.QA_REVIEW_CACHE_ENABLED !== "false";
}

/** A hash of every file the reviewers would read, by labeled path and content. */
export function fingerprintCode(dirs: LabeledDir[]): string {
  const h = createHash("sha256");
  for (const path of listLabeledFiles(dirs).sort()) {
    const abs = resolveLabeledFile(dirs, path);
    let content = "";
    try {
      content = abs ? readFileSync(abs, "utf-8") : "";
    } catch {
      content = "";
    }
    h.update(path).update("\0").update(content.replace(/\r\n/g, "\n")).update("\0");
  }
  return h.digest("hex").slice(0, 24);
}

interface CacheEntry<T> {
  hash: string;
  result: T;
  at: string;
}

function cacheFile(projectId: string): string {
  return join(process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds", projectId, "review-pass-cache.json");
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
 * Runs `run` unless this reviewer already passed on this exact code. The
 * fingerprint is computed once per call site and shared by the three reviewers
 * through `fingerprint` when the caller passes it.
 */
export async function withReviewCache<T extends { passed: boolean }>(
  projectId: string,
  reviewer: string,
  dirs: LabeledDir[],
  run: () => Promise<T>,
  fingerprint?: string,
): Promise<T> {
  if (!isReviewCacheEnabled()) return run();
  const hash = fingerprint ?? fingerprintCode(dirs);
  const all = readAll(projectId);
  const hit = all[reviewer] as CacheEntry<T> | undefined;
  if (hit && hit.hash === hash && hit.result?.passed) {
    console.log(`[stage5] ${reviewer}: the code is unchanged since this reviewer last passed it (${hit.at}) — not run again`);
    return hit.result;
  }
  const result = await run();
  if (result.passed) {
    try {
      mkdirSync(join(process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds", projectId), { recursive: true });
      const next = { ...readAll(projectId), [reviewer]: { hash, result, at: new Date().toISOString() } };
      writeFileSync(cacheFile(projectId), JSON.stringify(next), "utf-8");
    } catch (err) {
      console.error(`[stage5] could not save the review cache: ${String(err).slice(0, 120)}`);
    }
  }
  return result;
}
