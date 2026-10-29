// The system version a build runs on. A build is a test of ONE version of the system: the version is stamped when the
// build starts, checked before each paid stage, and a change holds the build until the owner decides (Retry accepts the
// new version, and the record keeps that the build ran on a changed system). Audit 2026-10-29: every full build had
// system changes committed while it ran, so no build ever measured one version.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SOURCE_DIRS = ["agents", "packages", "pipeline", "apps/api"] as const;

export interface SystemVersion {
  id: string;
  commit: string;
  trees: Record<string, string>;
  dirtyFiles: string[];
  /** Uncommitted source files and the hash of their content ("deleted" when removed). */
  dirty?: Record<string, string>;
}

export type GitRunner = (args: string[], cwd: string) => Promise<string>;

// Async on purpose: synchronous child processes fail with ETIMEDOUT inside the long-running worker.
const runGit: GitRunner = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout: 20_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });

const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

function statusPaths(porcelain: string): string[] {
  return porcelain
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => l.slice(3).split(" -> ").pop()!.replace(/^"|"$/g, ""))
    .sort();
}

/** The version of the source folders: their committed content plus any uncommitted change. Null when git cannot answer. */
export async function readSystemVersion(repoRoot: string, git: GitRunner = runGit): Promise<SystemVersion | null> {
  try {
    const commit = (await git(["rev-parse", "HEAD"], repoRoot)).trim();
    const trees: Record<string, string> = {};
    for (const d of SOURCE_DIRS) trees[d] = (await git(["rev-parse", `HEAD:${d}`], repoRoot)).trim();
    const dirtyFiles = statusPaths(await git(["status", "--porcelain=v1", "--untracked-files=all", "--", ...SOURCE_DIRS], repoRoot));
    const dirty: Record<string, string> = {};
    for (const f of dirtyFiles) {
      const full = join(repoRoot, f);
      dirty[f] = existsSync(full) ? sha(readFileSync(full)) : "deleted";
    }
    const dirtyPart = dirtyFiles.map((f) => `${f}:${dirty[f]}`).join("\n");
    const id = sha(`${SOURCE_DIRS.map((d) => `${d}=${trees[d]}`).join(",")}|${dirtyPart}`).slice(0, 16);
    return { id, commit, trees, dirtyFiles, dirty };
  } catch {
    return null;
  }
}

interface Stamp extends SystemVersion {
  at: string;
  step: string;
}
interface VersionEvent {
  at: string;
  kind: "stamp" | "hold" | "accepted" | "not_checked";
  step: string;
  id: string | null;
  detail: string;
}
interface VersionRecord {
  started: Stamp | null;
  accepted: string[];
  pending: Stamp | null;
  events: VersionEvent[];
}

const fileOf = (buildDir: string) => join(buildDir, ".nexsidi", "system-version.json");

function load(buildDir: string): VersionRecord | null {
  const f = fileOf(buildDir);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf-8")) as VersionRecord;
  } catch {
    return null;
  }
}

function save(buildDir: string, r: VersionRecord): void {
  mkdirSync(join(buildDir, ".nexsidi"), { recursive: true });
  writeFileSync(fileOf(buildDir), JSON.stringify(r, null, 2), "utf-8");
}

function stampRecord(current: SystemVersion | null, step: string, now: Date, detail: string): VersionRecord {
  const at = now.toISOString();
  if (!current) return { started: null, accepted: [], pending: null, events: [{ at, kind: "not_checked", step, id: null, detail: "the version could not be read at build start" }] };
  return { started: { ...current, at, step }, accepted: [current.id], pending: null, events: [{ at, kind: "stamp", step, id: current.id, detail }] };
}

/** Called when the build starts. Never replaces an existing stamp. */
export function stampSystemVersion(buildDir: string, current: SystemVersion | null, step: string, now = new Date()): void {
  if (load(buildDir)) return;
  save(buildDir, stampRecord(current, step, now, `build started on commit ${current?.commit.slice(0, 12) ?? "?"}`));
}

export type VersionVerdict = { ok: true } | { ok: false; reason: string; evidence: string[] };

/** Called before each paid stage. A version the owner has not accepted holds the build. */
export function checkSystemVersion(buildDir: string, current: SystemVersion | null, step: string, now = new Date()): VersionVerdict {
  const at = now.toISOString();
  let r = load(buildDir);
  if (!r) {
    save(buildDir, stampRecord(current, step, now, "stamped late: the build started before the version stamp existed"));
    return { ok: true };
  }
  if (!current) {
    r.events.push({ at, kind: "not_checked", step, id: null, detail: "git could not read the system version" });
    save(buildDir, r);
    return { ok: true };
  }
  if (!r.started) {
    r = { ...r, started: { ...current, at, step }, accepted: [current.id] };
    r.events.push({ at, kind: "stamp", step, id: current.id, detail: "stamped at the first check that could read the version" });
    save(buildDir, r);
    return { ok: true };
  }
  if (r.accepted.includes(current.id)) return { ok: true };
  const base = r.started;
  const changedDirs = Object.keys(current.trees).filter((d) => current.trees[d] !== base.trees[d]);
  const changedFiles = current.dirty
    ? [...new Set([...Object.keys(current.dirty), ...Object.keys(base.dirty ?? {})])].filter((f) => current.dirty![f] !== base.dirty?.[f]).sort()
    : current.dirtyFiles;
  const evidence = [
    `started on version ${base.id} (commit ${base.commit.slice(0, 12)}), now ${current.id} (commit ${current.commit.slice(0, 12)})`,
    changedDirs.length ? `committed changes in: ${changedDirs.join(", ")}` : "no committed change in the source folders",
    changedFiles.length ? `uncommitted files changed since the build started: ${changedFiles.slice(0, 20).join(", ")}` : "no uncommitted file changed since the build started",
  ];
  r.pending = { ...current, at, step };
  r.events.push({ at, kind: "hold", step, id: current.id, detail: evidence.join("; ") });
  save(buildDir, r);
  return { ok: false, reason: `the system changed while this build was running (before ${step})`, evidence };
}

/** The owner's Retry on a system-change hold: the pending version is accepted. Returns its id, or null when none was pending. */
export function acceptPendingSystemVersion(buildDir: string, now = new Date()): string | null {
  const r = load(buildDir);
  if (!r?.pending) return null;
  const id = r.pending.id;
  r.accepted.push(id);
  r.events.push({ at: now.toISOString(), kind: "accepted", step: r.pending.step, id, detail: "the owner's Retry continued the build on the changed system" });
  r.pending = null;
  save(buildDir, r);
  return id;
}

export interface SystemVersionFacts {
  recorded: boolean;
  startedOn: string | null;
  changes: number;
  accepted: number;
  notChecked: number;
}

export function systemVersionFacts(buildDir: string): SystemVersionFacts {
  const r = load(buildDir);
  if (!r) return { recorded: false, startedOn: null, changes: 0, accepted: 0, notChecked: 0 };
  const count = (k: VersionEvent["kind"]) => r.events.filter((e) => e.kind === k).length;
  return { recorded: true, startedOn: r.started?.id ?? null, changes: count("hold"), accepted: count("accepted"), notChecked: count("not_checked") };
}
