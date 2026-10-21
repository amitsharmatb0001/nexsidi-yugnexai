// Transactional handoffs with a way back (patent claims 3(d) and 1(c)).
//
// A handoff is the moment one agent's output becomes the next agent's input. Two things make it transactional:
//  1. The handoff file is written whole to a temporary name, read back and checked against its hash, and only then
//     moved into place in one step (stageHandoffFile). Until the move nothing is visible; if any step fails nothing remains.
//  2. After a handoff the project's own files are copied to a snapshot (takeSnapshot). When a later handoff proves corrupt,
//     restoreSnapshot puts the files back to the last good state instead of only stopping the work.
// Only the project's own files are tracked: dependencies, build output and agent histories are never copied or touched.
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const TRACKED_DIRS = ["frontend", "backend", "db"];
const TRACKED_ROOT_FILES = ["spec.json", "api-contract.json", "db-schema.json", "build-plan.json", "shared-types.ts", "docker-compose.yml", "phases.json", "user-request.txt"];
const SKIPPED_DIR_NAMES = new Set(["node_modules", ".next", "dist", "build", ".git", "coverage", "logs", ".turbo", ".cache"]);
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_KEEP = 6;

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const posix = (p: string) => p.split("\\").join("/");

export interface SnapshotInfo {
  id: string;
  label: string;
  createdAt: string;
  fileCount: number;
}

interface Manifest extends SnapshotInfo {
  files: Record<string, string>;
}

const snapshotsRoot = (buildDir: string) => join(buildDir, ".nexsidi", "snapshots");

/** Relative paths (forward slashes) of every tracked file currently in the project. */
function trackedFiles(buildDir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    const abs = join(buildDir, rel);
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIR_NAMES.has(entry.name)) walk(posix(join(rel, entry.name)));
      } else if (entry.isFile()) {
        const childRel = posix(join(rel, entry.name));
        try {
          if (statSync(join(buildDir, childRel)).size <= MAX_FILE_BYTES) out.push(childRel);
        } catch {
          /* a file that vanished while walking is not part of this snapshot */
        }
      }
    }
  };
  for (const d of TRACKED_DIRS) if (existsSync(join(buildDir, d))) walk(d);
  for (const f of TRACKED_ROOT_FILES) if (existsSync(join(buildDir, f))) out.push(f);
  return out;
}

function readManifest(buildDir: string, id: string): Manifest | null {
  try {
    return JSON.parse(readFileSync(join(snapshotsRoot(buildDir), id, "manifest.json"), "utf-8")) as Manifest;
  } catch {
    return null;
  }
}

function snapshotIds(buildDir: string): string[] {
  const root = snapshotsRoot(buildDir);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

export function latestSnapshot(buildDir: string): SnapshotInfo | null {
  const ids = snapshotIds(buildDir);
  for (let i = ids.length - 1; i >= 0; i--) {
    const m = readManifest(buildDir, ids[i]!);
    if (m) return { id: m.id, label: m.label, createdAt: m.createdAt, fileCount: m.fileCount };
  }
  return null;
}

/** Copies the project's tracked files. A project identical to the latest snapshot is not copied again; that snapshot is returned. */
export function takeSnapshot(buildDir: string, label: string, opts: { keep?: number } = {}): SnapshotInfo | null {
  if (!existsSync(buildDir)) return null;
  const files: Record<string, string> = {};
  for (const rel of trackedFiles(buildDir)) files[rel] = sha256(readFileSync(join(buildDir, rel)));

  const latest = latestSnapshot(buildDir);
  if (latest) {
    const m = readManifest(buildDir, latest.id)!;
    const same = Object.keys(files).length === Object.keys(m.files).length && Object.entries(files).every(([k, v]) => m.files[k] === v);
    if (same) return latest;
  }

  const id = `${String(Date.now()).padStart(14, "0")}-${randomBytes(2).toString("hex")}-${label.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 40)}`;
  const root = join(snapshotsRoot(buildDir), id);
  for (const rel of Object.keys(files)) {
    const target = join(root, "files", rel);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(buildDir, rel), target);
  }
  const info: Manifest = { id, label, createdAt: new Date().toISOString(), fileCount: Object.keys(files).length, files };
  writeFileSync(join(root, "manifest.json"), JSON.stringify(info), "utf-8");

  const keep = opts.keep ?? DEFAULT_KEEP;
  for (const old of snapshotIds(buildDir).slice(0, -keep)) rmSync(join(snapshotsRoot(buildDir), old), { recursive: true, force: true });
  return { id, label, createdAt: info.createdAt, fileCount: info.fileCount };
}

export interface RestoreResult {
  snapshot: SnapshotInfo;
  restored: string[];
  removed: string[];
}

/** Puts the tracked files back as they were in a snapshot (the latest by default). Null when there is no snapshot. */
export function restoreSnapshot(buildDir: string, id?: string): RestoreResult | null {
  const chosen = id ?? latestSnapshot(buildDir)?.id;
  if (!chosen) return null;
  const manifest = readManifest(buildDir, chosen);
  if (!manifest) return null;
  const restored: string[] = [];
  const removed: string[] = [];
  for (const [rel, hash] of Object.entries(manifest.files)) {
    const target = join(buildDir, rel);
    const current = existsSync(target) ? sha256(readFileSync(target)) : null;
    if (current === hash) continue;
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(snapshotsRoot(buildDir), chosen, "files", rel), target);
    restored.push(rel);
  }
  for (const rel of trackedFiles(buildDir)) {
    if (!(rel in manifest.files)) {
      rmSync(join(buildDir, rel), { force: true });
      removed.push(rel);
    }
  }
  return { snapshot: { id: manifest.id, label: manifest.label, createdAt: manifest.createdAt, fileCount: manifest.fileCount }, restored, removed };
}

export interface StagedHandoff {
  /** SHA-256 of the staged content. */
  hash: string;
  /** Moves the checked file into place in one step. Throws if it cannot. */
  commit(): string;
  /** Removes the staged file, or the committed one. Safe to call at any point. */
  abort(): void;
}

/** Writes a handoff file under a temporary name, reads it back and checks it, and returns handles to commit or abort it. */
export function stageHandoffFile(dir: string, finalName: string, content: string): StagedHandoff {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.tmp-${randomBytes(4).toString("hex")}-${finalName}`);
  const final = join(dir, finalName);
  const hash = sha256(content);
  writeFileSync(tmp, content, "utf-8");
  if (sha256(readFileSync(tmp)) !== hash) {
    rmSync(tmp, { force: true });
    throw new Error(`handoff file ${finalName} was not written intact`);
  }
  let committed = false;
  return {
    hash,
    commit() {
      renameSync(tmp, final);
      committed = true;
      return final;
    },
    abort() {
      rmSync(tmp, { force: true });
      if (committed) rmSync(final, { force: true });
    },
  };
}
