// Artifact viewer routes — browse and read files in a project's generated build.
//
// GET /api/artifacts/:projectId/tree  — recursive file tree for the build directory
// GET /api/artifacts/:projectId/file  — read a single file (?path=relative/path)
//
// Security:
//   - Ownership check: projectId must belong to the requesting userId
//   - Path traversal guard: resolved path must be a child of BUILD_DIR/{projectId}

import { Hono } from "hono";
import { readdir, readFile, stat } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, extname, sep } from "path";
import { execFileSync } from "child_process";
import { db, projects } from "@nexsidi/db";
import { and, eq } from "drizzle-orm";

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
    const git = (args: string[]) =>
      execFileSync("git", args, {
        cwd: projectDir,
        encoding: "utf-8",
        maxBuffer: 12 * 1024 * 1024,
        // A repo with no commits, or no git binary, must degrade to "no diff
        // available" rather than take the console's Changes tab down with it.
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();

    const baseline = resolveBaseline(git);
    if (!baseline) return c.json({ projectId, base: null, files: [] });

    const stat = git(["diff", "--numstat", `${baseline}..HEAD`]);
    const files = stat
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [added, removed, path] = line.split("\t");
        return {
          path: toPosixPath(path ?? ""),
          // "-" marks a binary file in numstat; report it as such rather than
          // coercing it to a misleading 0.
          added: added === "-" ? null : Number(added),
          removed: removed === "-" ? null : Number(removed),
          binary: added === "-",
        };
      })
      .filter((f) => f.path && !isPipelineBookkeeping(f.path));

    return c.json({ projectId, base: baseline.slice(0, 7), files });
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
    const git = (args: string[]) =>
      execFileSync("git", args, {
        cwd: projectDir,
        encoding: "utf-8",
        maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();

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
