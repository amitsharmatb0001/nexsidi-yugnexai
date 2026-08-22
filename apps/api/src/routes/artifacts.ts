// Artifact viewer routes — browse and read files in a project's generated build.
//
// GET  /api/artifacts/:projectId/tree         — recursive file tree for the build directory
// GET  /api/artifacts/:projectId/file         — read a single file (?path=relative/path)
// GET  /api/artifacts/:projectId/diff         — what changed since the build's baseline commit
// GET  /api/artifacts/:projectId/diff/file    — unified patch for one changed file
// POST /api/artifacts/:projectId/diff/accept       — mark one file reviewed (no content change)
// POST /api/artifacts/:projectId/diff/accept-all   — mark every currently-changed file reviewed
// POST /api/artifacts/:projectId/diff/reject       — revert one file to its pre-build content
// POST /api/artifacts/:projectId/diff/reject-all   — revert every currently-changed file
//
// Security:
//   - Ownership check: projectId must belong to the requesting userId
//   - Path traversal guard: resolved path must be a child of BUILD_DIR/{projectId}

import { Hono } from "hono";
import { readdir, readFile, stat } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, extname, sep } from "path";
import { execFileSync } from "child_process";
import { db, projects, diffReviews } from "@nexsidi/db";
import { and, eq } from "drizzle-orm";
import { isSecretPath } from "../utils/secret-paths.ts";

type Env = { Variables: { userId: string } };
export const artifactsRouter = new Hono<Env>();

const BUILD_DIR = process.env.BUILD_DIR ?? "/tmp/nexsidi-builds";

// ── File type detection ───────────────────────────────────────────────────────
const EXT_LANG: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript",
  ".js": "javascript", ".jsx": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".sql": "sql",
  ".css": "css",
  ".html": "html",
  ".yaml": "yaml", ".yml": "yaml",
  ".toml": "toml",
  ".sh": "bash",
  ".env": "dotenv",
  ".dockerfile": "dockerfile",
  ".prisma": "prisma",
  ".graphql": "graphql",
};

function detectLanguage(filePath: string): string {
  const base = filePath.split("/").pop() ?? "";
  if (base.toLowerCase() === "dockerfile") return "dockerfile";
  if (base.toLowerCase().startsWith(".env")) return "dotenv";
  return EXT_LANG[extname(filePath).toLowerCase()] ?? "text";
}

// ── Recursive directory walker ────────────────────────────────────────────────
interface FileNode {
  name: string;
  path: string;        // relative to project root
  type: "file" | "directory";
  size?: number;       // bytes, files only
  lang?: string;       // language hint, files only
  children?: FileNode[];
}

const IGNORED = new Set([
  "node_modules", ".git", ".next", "dist", "build",
  ".turbo", ".cache", "__pycache__",
]);

/**
 * Normalises a filesystem-relative path to forward slashes for the wire.
 * Exported for direct unit testing, since the surrounding walker needs a real
 * directory tree to exercise.
 */
export function toPosixPath(p: string): string {
  return p.split(/[\\/]+/).filter(Boolean).join("/");
}

async function buildTree(dir: string, base: string): Promise<FileNode[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;

    const abs  = join(dir, entry.name);
    // 2026-08-19: real bug found live — `rel` came straight off join(), so on
    // Windows every emitted path used backslashes ("backend\src\app.ts").
    // That is an OS detail leaking into a wire format: the web client splits
    // these on "/" to build its folder tree, so nothing ever nested and the
    // explorer rendered one flat row per file with the raw backslash path as
    // its name. The same string is also handed back as ?path= on the file
    // endpoint, so the wire format has to be platform-independent regardless.
    // resolve() on the read side accepts either separator, so normalising
    // here is safe for existing callers.
    const rel  = toPosixPath(abs.slice(base.length + 1));  // relative to project root

    if (entry.isDirectory()) {
      nodes.push({
        name:     entry.name,
        path:     rel,
        type:     "directory",
        children: await buildTree(abs, base),
      });
    } else {
      const info = await stat(abs);
      nodes.push({
        name: entry.name,
        path: rel,
        type: "file",
        size: info.size,
        lang: detectLanguage(entry.name),
      });
    }
  }

  return nodes.sort((a, b) => {
    // directories first, then files, each group alpha-sorted
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ── Ownership guard ───────────────────────────────────────────────────────────
async function assertOwns(projectId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return !!row;
}

// ── GET /api/artifacts/:projectId/tree ────────────────────────────────────────
artifactsRouter.get("/:projectId/tree", async (c) => {
  const userId    = c.get("userId") as string | undefined;
  const projectId = c.req.param("projectId");

  // Ownership check only when authenticated (public build page access skips it)
  if (userId && !await assertOwns(projectId, userId)) {
    return c.json({ error: "not_found" }, 404);
  }

  const projectDir = resolve(BUILD_DIR, projectId);
  if (!existsSync(projectDir)) {
    return c.json({ error: "build_not_ready" }, 404);
  }

  const tree = await buildTree(projectDir, projectDir);
  return c.json({ projectId, tree });
});

/**
 * The commit to diff against: the EARLIEST "nexsidi-initial-state".
 *
 * The pipeline writes one of these bookend commits at the start of every
 * deploy cycle, so a project that was redeployed has several. Taking the most
 * recent one answers "what changed since the last redeploy" — usually two
 * bookkeeping files — when the question a reviewer has is "what did this
 * build produce". Falls back to the repo's root commit for projects created
 * before the bookend convention.
 */
function resolveBaseline(git: (args: string[]) => string): string {
  // `git log -n 1` would apply the limit before ordering, so the whole list is
  // read and the last (oldest) entry taken.
  const all = git(["log", "--format=%H", "--grep=nexsidi-initial-state"])
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return all[all.length - 1] ?? git(["rev-list", "--max-parents=0", "HEAD", "-n", "1"]);
}

/**
 * Files the pipeline writes about itself, rather than files belonging to the
 * generated app. A reviewer looking at "what changed" wants their own source,
 * not the run's logs and QA bookkeeping — those dominate the diff by line
 * count and bury the handful of real edits.
 */
export function isPipelineBookkeeping(path: string): boolean {
  return (
    path.startsWith("logs/") ||
    path.endsWith(".jsonl") ||
    /^history-[a-z]+\.json$/.test(path) ||
    path === "qa-submissions.json"
  );
}

/**
 * A git subprocess runner bound to one project's working directory — the
 * same execFileSync options every route in this file that touches git needs,
 * factored out once rather than repeated at each call site.
 *
 * Real incident found live (Brightline Consulting test build): a project
 * whose generators ran `npm install`/`next build` for their own
 * verification (real, routine — no .gitignore is ever written for a
 * generated project, so there is nothing to stop `git add -A` at delivery
 * from tracking node_modules) produced a repo with tens of thousands of
 * files. `git diff --numstat`/`--name-status` against it took long enough
 * to exceed nothing (no timeout existed) and hung — and because
 * execFileSync is SYNCHRONOUS, that one request froze the entire
 * single-threaded API process, timing out every other in-flight request,
 * not just this one. `timeout` here is the fix that actually bounds the
 * blast radius; getDiffFiles below additionally excludes the common bloat
 * directories via pathspec so a normal project never gets close to the
 * timeout in the first place.
 */
function gitRunner(projectDir: string): (args: string[]) => string {
  return (args: string[]) =>
    execFileSync("git", args, {
      cwd: projectDir,
      encoding: "utf-8",
      maxBuffer: 12 * 1024 * 1024,
      // 30s, not a tighter bound: measured live against a real repo with
      // ~15k untracked node_modules files still walked by pathspec exclusion
      // (excluding a path's DIFF doesn't skip walking it), each of the two
      // sequential calls in getDiffFiles took anywhere from ~4s to >15s
      // across repeated runs on the same machine — Windows Defender
      // real-time scanning touching every file git walks is the likely
      // cause, not anything this code controls. The real fix is upstream
      // (a .gitignore so node_modules is never tracked at all — see
      // getDiffFiles' own comment); this bound only has to be generous
      // enough not to fail a normal, non-bloated project's real diff.
      timeout: 30_000,
      // A repo with no commits, or no git binary, must degrade to "no diff
      // available" rather than take the console's Changes tab down with it.
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

/**
 * Pathspec exclusions for directories that are never real generated
 * source — dependency trees and build output a generated project's own
 * verification commands (npm install, next build, tsc) can leave behind
 * with nothing ever having written a .gitignore to keep them out of git in
 * the first place. Applied directly to the git diff command (not filtered
 * from its output afterward) so git never has to walk or diff their
 * contents at all — the actual fix for the hang above, not just a display
 * nicety.
 */
const DIFF_EXCLUDE_PATHSPECS = [
  ":(exclude)**/node_modules/**",
  ":(exclude)**/.next/**",
  ":(exclude)**/dist/**",
  ":(exclude)**/build/**",
  ":(exclude)**/.turbo/**",
  ":(exclude)**/__pycache__/**",
];

export type DiffFileStatus = "added" | "modified" | "deleted";

export interface DiffFile {
  path: string;
  added: number | null;
  removed: number | null;
  binary: boolean;
  status: DiffFileStatus;
  /** The file's git blob hash at HEAD, or the literal "deleted" when the
   * file doesn't exist at HEAD. Identifies exactly which version of this
   * path's diff this is — see diffReviews' own comment in schema.ts for
   * why baseline+path alone isn't a precise enough key. */
  contentHash: string;
}

/** The git blob hash for `path` at HEAD — a cheap, exact fingerprint git
 * already maintains, reused rather than hashing file content ourselves. */
function contentHashFor(git: (args: string[]) => string, path: string, status: DiffFileStatus): string {
  if (status === "deleted") return "deleted";
  try {
    return git(["rev-parse", `HEAD:${path}`]);
  } catch {
    // Should not happen for "added"/"modified" (both mean the path exists
    // at HEAD), but a review mark that fails to key precisely must never
    // take the endpoint down over it.
    return "unknown";
  }
}

/**
 * Parses `git diff --name-status` output into a path → status map.
 *
 * A rename or copy line carries two tab-separated paths (old, new) rather
 * than one; the destination (last field) is what the caller's numstat rows
 * key on, so that's what's kept. Renames/copies are folded into "modified"
 * — reject's revert strategy for "modified" (checkout the baseline blob at
 * this path) only holds for a genuine rename if the path existed at the
 * baseline under the same name, which is not guaranteed; generated code
 * from a single pipeline run essentially never renames an existing file, so
 * this is an accepted edge case rather than something worth a third
 * revert strategy.
 */
export function parseNameStatus(raw: string): Map<string, DiffFileStatus> {
  const byPath = new Map<string, DiffFileStatus>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0] ?? "";
    const path = toPosixPath(parts[parts.length - 1] ?? "");
    if (!path) continue;
    if (code.startsWith("A")) byPath.set(path, "added");
    else if (code.startsWith("D")) byPath.set(path, "deleted");
    else byPath.set(path, "modified"); // M, R*, C*, T all land here
  }
  return byPath;
}

/**
 * What the agents actually changed since the build's baseline commit, with
 * enough detail (added/removed line counts, added/modified/deleted status)
 * to both display the diff and know how to revert any one file. Shared by
 * the GET /diff endpoint and every accept/reject mutation below, so the
 * "what's currently in the diff" answer can never drift between what a user
 * sees and what a reject call is willing to act on.
 */
export function getDiffFiles(git: (args: string[]) => string, baseline: string): DiffFile[] {
  const statLines = git(["diff", "--numstat", `${baseline}..HEAD`, "--", ".", ...DIFF_EXCLUDE_PATHSPECS]);
  const statusByPath = parseNameStatus(
    git(["diff", "--name-status", `${baseline}..HEAD`, "--", ".", ...DIFF_EXCLUDE_PATHSPECS]),
  );

  return statLines
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [added, removed, rawPath] = line.split("\t");
      const path = toPosixPath(rawPath ?? "");
      const status = statusByPath.get(path) ?? "modified";
      return {
        path,
        // "-" marks a binary file in numstat; report it as such rather than
        // coercing it to a misleading 0.
        added: added === "-" ? null : Number(added),
        removed: removed === "-" ? null : Number(removed),
        binary: added === "-",
        status,
        contentHash: path ? contentHashFor(git, path, status) : "",
      };
    })
    .filter((f) => f.path && !isPipelineBookkeeping(f.path));
}

/**
 * Reverts one file to its baseline content in the working tree + index —
 * the mutation half of "reject"; the caller commits afterward. A file that
 * didn't exist at the baseline (status "added") has no baseline blob to
 * check out, so rejecting it means removing it instead.
 */
export function revertFile(git: (args: string[]) => string, baseline: string, file: DiffFile): void {
  if (file.status === "added") {
    git(["rm", "-f", "--", file.path]);
  } else {
    git(["checkout", baseline, "--", file.path]);
  }
}

// ── GET /api/artifacts/:projectId/diff ────────────────────────────────────────
// What the agents actually changed, as a real diff.
//
// Every build dir is a git repo, and the pipeline tags its own bookends:
// a "nexsidi-initial-state" commit before the agents touch anything, and an
// "Initial delivery" commit after. Diffing HEAD against the most recent
// initial-state commit is therefore exactly "what this build produced",
// which is the question a reviewer actually has.
artifactsRouter.get("/:projectId/diff", async (c) => {
  const userId    = c.get("userId") as string | undefined;
  const projectId = c.req.param("projectId");

  if (userId && !await assertOwns(projectId, userId)) {
    return c.json({ error: "not_found" }, 404);
  }

  const projectDir = resolve(BUILD_DIR, projectId);
  if (!existsSync(projectDir)) {
    return c.json({ error: "build_not_ready" }, 404);
  }

  try {
    const git = gitRunner(projectDir);

    const baseline = resolveBaseline(git);
    if (!baseline) return c.json({ projectId, base: null, files: [] });
    const shortBase = baseline.slice(0, 7);

    const files = getDiffFiles(git, baseline);

    // Which of these the user already marked reviewed, at THIS baseline AND
    // this exact content — see diffReviews' schema.ts comment for why a
    // file whose diff changed again against an unchanged baseline must not
    // inherit a stale "accepted" mark from its earlier content.
    const reviewed = files.length === 0 ? [] : await db
      .select({ path: diffReviews.path, contentHash: diffReviews.contentHash })
      .from(diffReviews)
      .where(and(eq(diffReviews.projectId, projectId), eq(diffReviews.baseline, shortBase)));
    const reviewedKeys = new Set(reviewed.map((r) => `${r.path} ${r.contentHash}`));

    return c.json({
      projectId,
      base: shortBase,
      files: files.map((f) => ({ ...f, reviewed: reviewedKeys.has(`${f.path} ${f.contentHash}`) })),
    });
  } catch (err) {
    return c.json({ projectId, base: null, files: [], error: String(err).slice(0, 200) });
  }
});

// ── GET /api/artifacts/:projectId/diff/file?path= ─────────────────────────────
// The unified patch for one file, so the console can render it inline.
artifactsRouter.get("/:projectId/diff/file", async (c) => {
  const userId      = c.get("userId") as string | undefined;
  const projectId   = c.req.param("projectId");
  const requestPath = c.req.query("path") ?? "";

  if (!requestPath) return c.json({ error: "path required" }, 400);
  // Same content-class guard as the plain file route, applied here too: a
  // patch against a credential file still contains the credential's value.
  if (isSecretPath(requestPath)) return c.json({ error: "forbidden" }, 403);
  if (userId && !await assertOwns(projectId, userId)) {
    return c.json({ error: "not_found" }, 404);
  }

  const projectDir = resolve(BUILD_DIR, projectId);
  if (!existsSync(projectDir)) return c.json({ error: "build_not_ready" }, 404);

  // Same containment rule the file endpoint uses — a path arriving from the
  // client must not be able to address anything outside the project.
  const fullPath = resolve(projectDir, requestPath);
  if (!fullPath.startsWith(projectDir + sep) && fullPath !== projectDir) {
    return c.json({ error: "forbidden" }, 403);
  }

  try {
    const git = gitRunner(projectDir);

    const baseline = resolveBaseline(git);
    if (!baseline) return c.json({ path: requestPath, patch: "" });

    // "--" separates the revision range from the pathspec, so a filename that
    // looks like a flag or a ref cannot be reinterpreted as one.
    const patch = git(["diff", `${baseline}..HEAD`, "--", requestPath]);
    return c.json({ path: requestPath, patch });
  } catch (err) {
    return c.json({ path: requestPath, patch: "", error: String(err).slice(0, 200) });
  }
});

// ── POST /api/artifacts/:projectId/diff/accept ────────────────────────────────
// Marks one currently-changed file reviewed — an acknowledgement, not a
// mutation. The file's content is exactly what the pipeline wrote; nothing
// on disk changes.
artifactsRouter.post("/:projectId/diff/accept", async (c) => {
  const userId    = c.get("userId") as string | undefined;
  const projectId = c.req.param("projectId");

  if (userId && !await assertOwns(projectId, userId)) {
    return c.json({ error: "not_found" }, 404);
  }

  const body = await c.req.json().catch(() => null) as { path?: unknown } | null;
  const path = typeof body?.path === "string" ? body.path : "";
  if (!path) return c.json({ error: "path required" }, 400);

  const projectDir = resolve(BUILD_DIR, projectId);
  if (!existsSync(projectDir)) return c.json({ error: "build_not_ready" }, 404);

  try {
    const git = gitRunner(projectDir);
    const baseline = resolveBaseline(git);
    if (!baseline) return c.json({ error: "no_baseline" }, 400);
    const shortBase = baseline.slice(0, 7);

    // The path must be something the diff actually contains right now — a
    // client-supplied path is never trusted just because it looks plausible.
    const target = getDiffFiles(git, baseline).find((f) => f.path === path);
    if (!target) return c.json({ error: "not_in_diff" }, 404);

    await db.insert(diffReviews)
      .values({ projectId, baseline: shortBase, path, contentHash: target.contentHash })
      .onConflictDoNothing();

    return c.json({ path, reviewed: true });
  } catch (err) {
    return c.json({ error: String(err).slice(0, 200) }, 500);
  }
});

// ── POST /api/artifacts/:projectId/diff/accept-all ────────────────────────────
artifactsRouter.post("/:projectId/diff/accept-all", async (c) => {
  const userId    = c.get("userId") as string | undefined;
  const projectId = c.req.param("projectId");

  if (userId && !await assertOwns(projectId, userId)) {
    return c.json({ error: "not_found" }, 404);
  }

  const projectDir = resolve(BUILD_DIR, projectId);
  if (!existsSync(projectDir)) return c.json({ error: "build_not_ready" }, 404);

  try {
    const git = gitRunner(projectDir);
    const baseline = resolveBaseline(git);
    if (!baseline) return c.json({ accepted: [] });
    const shortBase = baseline.slice(0, 7);

    const files = getDiffFiles(git, baseline);
    if (files.length === 0) return c.json({ accepted: [] });

    await db.insert(diffReviews)
      .values(files.map((f) => ({ projectId, baseline: shortBase, path: f.path, contentHash: f.contentHash })))
      .onConflictDoNothing();

    return c.json({ accepted: files.map((f) => f.path) });
  } catch (err) {
    return c.json({ error: String(err).slice(0, 200) }, 500);
  }
});

// ── POST /api/artifacts/:projectId/diff/reject ────────────────────────────────
// Reverts one file to its pre-build content and commits the revert, so the
// file has no diff against the baseline afterward and simply drops out of
// the Changes list — there is no separate "rejected" status to track.
artifactsRouter.post("/:projectId/diff/reject", async (c) => {
  const userId    = c.get("userId") as string | undefined;
  const projectId = c.req.param("projectId");

  if (userId && !await assertOwns(projectId, userId)) {
    return c.json({ error: "not_found" }, 404);
  }

  const body = await c.req.json().catch(() => null) as { path?: unknown } | null;
  const path = typeof body?.path === "string" ? body.path : "";
  if (!path) return c.json({ error: "path required" }, 400);

  const projectDir = resolve(BUILD_DIR, projectId);
  if (!existsSync(projectDir)) return c.json({ error: "build_not_ready" }, 404);

  // Same containment rule the file/diff-file endpoints use — a path arriving
  // from the client must not be able to address anything outside the project.
  const fullPath = resolve(projectDir, path);
  if (!fullPath.startsWith(projectDir + sep) && fullPath !== projectDir) {
    return c.json({ error: "forbidden" }, 403);
  }

  try {
    const git = gitRunner(projectDir);
    const baseline = resolveBaseline(git);
    if (!baseline) return c.json({ error: "no_baseline" }, 400);

    const files = getDiffFiles(git, baseline);
    const target = files.find((f) => f.path === path);
    if (!target) return c.json({ error: "not_in_diff" }, 404);

    revertFile(git, baseline, target);
    git(["commit", "-m", `reject: revert ${path} to pre-build state`, "-q"]);

    return c.json({ path, rejected: true });
  } catch (err) {
    return c.json({ error: String(err).slice(0, 200) }, 500);
  }
});

// ── POST /api/artifacts/:projectId/diff/reject-all ────────────────────────────
// Same as reject, for every currently-changed file. Each file's revert is
// attempted independently — one file failing (e.g. an unusual rename, see
// parseNameStatus) never blocks the rest — and everything that succeeded is
// committed together in a single commit.
artifactsRouter.post("/:projectId/diff/reject-all", async (c) => {
  const userId    = c.get("userId") as string | undefined;
  const projectId = c.req.param("projectId");

  if (userId && !await assertOwns(projectId, userId)) {
    return c.json({ error: "not_found" }, 404);
  }

  const projectDir = resolve(BUILD_DIR, projectId);
  if (!existsSync(projectDir)) return c.json({ error: "build_not_ready" }, 404);

  try {
    const git = gitRunner(projectDir);
    const baseline = resolveBaseline(git);
    if (!baseline) return c.json({ rejected: [], failed: [] });

    const files = getDiffFiles(git, baseline);
    if (files.length === 0) return c.json({ rejected: [], failed: [] });

    const rejected: string[] = [];
    const failed: string[] = [];
    for (const f of files) {
      try {
        revertFile(git, baseline, f);
        rejected.push(f.path);
      } catch {
        failed.push(f.path);
      }
    }

    if (rejected.length > 0) {
      const n = rejected.length;
      git(["commit", "-m", `reject: revert ${n} file${n === 1 ? "" : "s"} to pre-build state`, "-q"]);
    }

    return c.json({ rejected, failed });
  } catch (err) {
    return c.json({ error: String(err).slice(0, 200) }, 500);
  }
});

// ── GET /api/artifacts/:projectId/build-plan.json ─────────────────────────────
artifactsRouter.get("/:projectId/build-plan.json", async (c) => {
  const userId    = c.get("userId") as string | undefined;
  const projectId = c.req.param("projectId");

  if (userId && !await assertOwns(projectId, userId)) {
    return c.json({ error: "not_found" }, 404);
  }

  const planPath = resolve(BUILD_DIR, projectId, "build-plan.json");
  if (!existsSync(planPath)) {
    return c.json({ error: "build_plan_not_found" }, 404);
  }

  try {
    const content = await readFile(planPath, "utf-8");
    return c.json(JSON.parse(content));
  } catch (err) {
    return c.json({ error: "failed_to_read_plan" }, 500);
  }
});

// ── GET /api/artifacts/:projectId/file ────────────────────────────────────────
artifactsRouter.get("/:projectId/file", async (c) => {
  const userId      = c.get("userId") as string | undefined;
  const projectId   = c.req.param("projectId");
  const requestPath = c.req.query("path") ?? "";

  if (!requestPath) return c.json({ error: "path required" }, 400);

  // Unconditional — this endpoint is unauthenticated by design for pre-signup
  // build viewing (see isSecretPath's own header comment), so ownership alone
  // can't be the gate for anything credential-shaped.
  if (isSecretPath(requestPath)) return c.json({ error: "forbidden" }, 403);

  if (userId && !await assertOwns(projectId, userId)) {
    return c.json({ error: "not_found" }, 404);
  }

  const projectDir = resolve(BUILD_DIR, projectId);
  const fullPath   = resolve(projectDir, requestPath);

  // Path traversal guard — resolved path must be strictly inside projectDir
  const safeBase = projectDir + sep;
  if (!fullPath.startsWith(safeBase) && fullPath !== projectDir) {
    return c.json({ error: "forbidden" }, 403);
  }

  if (!existsSync(fullPath)) {
    return c.json({ error: "not_found" }, 404);
  }

  const info = await stat(fullPath);
  if (info.isDirectory()) return c.json({ error: "is_directory" }, 400);

  // Refuse files over 500 KB — protect against sending binary blobs
  if (info.size > 500 * 1024) {
    return c.json({ error: "file_too_large", size: info.size }, 413);
  }

  const content = await readFile(fullPath, "utf-8");
  const lang    = detectLanguage(requestPath);

  return c.json({
    path:    requestPath,
    lang,
    size:    info.size,
    content,
  });
});
