// Where a project's code lives on disk — by the app's own name, not a random id (2026-10-08, Amit).
//
// Before: E:/tmp/nexsidi-builds/52c4d13c5e0d, and because `docker compose` names its project after the folder, every
// container looked like 52c4d13c5e0d-frontend-1. Now: E:/tmp/nexsidi-builds/ledgerly-2 and ledgerly-2-frontend-1.
//
// The id stays the key everywhere else (database, workflow, logs). This module is the ONE place that turns an id into a
// folder: the name each project was given lives in a small registry file next to the folders (.folders.json), written
// when the project is created and read fresh by every process (API, worker). A project with no entry keeps the old
// id-named folder, so nothing that already exists moves or breaks.
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_ROOT = "E:/tmp/nexsidi-builds";
const REGISTRY = ".folders.json";

export function buildRoot(): string {
  return process.env.BUILD_DIR ?? DEFAULT_ROOT;
}

/** A safe folder name — and a valid `docker compose` project name — made from an app name; null when nothing usable is left. */
export function folderNameFor(name: string): string | null {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : null;
}

let cache: { file: string; stamp: string; map: Record<string, string> } | null = null;

function readRegistry(root: string): Record<string, string> {
  const file = join(root, REGISTRY);
  try {
    const st = statSync(file);
    const stamp = `${st.mtimeMs}:${st.size}`;
    if (cache && cache.file === file && cache.stamp === stamp) return cache.map;
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown;
    const map: Record<string, string> = {};
    if (parsed && typeof parsed === "object") {
      for (const [id, folder] of Object.entries(parsed as Record<string, unknown>)) if (typeof folder === "string" && folder) map[id] = folder;
    }
    cache = { file, stamp, map };
    return map;
  } catch {
    return {}; // no file yet, or a damaged one: the old id path is used
  }
}

/** The folder of a project: its registered name, or the old id-named folder. */
export function buildDirFor(projectId: string, root: string = buildRoot()): string {
  const folder = readRegistry(root)[projectId];
  return join(root, folder ?? projectId);
}

function writeRegistry(root: string, map: Record<string, string>): void {
  const file = join(root, REGISTRY);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(map, null, 2), "utf-8");
  renameSync(tmp, file);
  cache = null;
}

/**
 * Gives a project its named folder and creates it. Idempotent: a project that already has a folder keeps it. Two projects
 * with the same name get name, name-2, name-3…; a folder that already exists on disk is never reused.
 */
export function registerBuildFolder(projectId: string, name: string, root: string = buildRoot()): string {
  if (!/^[\w.-]+$/.test(projectId) || projectId === "." || projectId === ".." || projectId.includes("..")) {
    throw new Error(`registerBuildFolder: "${projectId}" is not a valid project id`);
  }
  mkdirSync(root, { recursive: true });
  const map = readRegistry(root);
  const existing = map[projectId];
  if (existing) return existing;

  const base = folderNameFor(name);
  let folder = projectId;
  if (base) {
    // An empty folder nobody is registered to holds nothing (a build that failed before writing a file) — reusable.
    // One a project IS registered to is that build's reservation, so it stays taken even while empty.
    const reserved = new Set(Object.values(map).map((d) => d.toLowerCase()));
    const used = safeList(root).filter((d) => reserved.has(d.toLowerCase()) || !isEmptyDir(join(root, d)));
    const taken = new Set([...reserved, ...used.map((d) => d.toLowerCase())]);
    folder = base;
    for (let n = 2; taken.has(folder); n++) folder = `${base}-${n}`.slice(0, 44);
  }
  mkdirSync(join(root, folder), { recursive: true });
  if (folder !== projectId) writeRegistry(root, { ...map, [projectId]: folder });
  return folder;
}

function isEmptyDir(dir: string): boolean {
  try {
    return readdirSync(dir).length === 0;
  } catch {
    return false;
  }
}

function safeList(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

