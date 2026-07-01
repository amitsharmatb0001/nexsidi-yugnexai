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

async function buildTree(dir: string, base: string): Promise<FileNode[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;

    const abs  = join(dir, entry.name);
    const rel  = abs.slice(base.length + 1);  // relative to project root

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
    .where(and(eq(projects.id, projectId), eq(projects.clerkId, userId)))
    .limit(1);
  return !!row;
}

// ── GET /api/artifacts/:projectId/tree ────────────────────────────────────────
artifactsRouter.get("/:projectId/tree", async (c) => {
  const userId    = c.get("userId") as string;
  const projectId = c.req.param("projectId");

  if (!await assertOwns(projectId, userId)) {
    return c.json({ error: "not_found" }, 404);
  }

  const projectDir = resolve(BUILD_DIR, projectId);
  if (!existsSync(projectDir)) {
    return c.json({ error: "build_not_ready" }, 404);
  }

  const tree = await buildTree(projectDir, projectDir);
  return c.json({ projectId, tree });
});

// ── GET /api/artifacts/:projectId/file ────────────────────────────────────────
artifactsRouter.get("/:projectId/file", async (c) => {
  const userId      = c.get("userId") as string;
  const projectId   = c.req.param("projectId");
  const requestPath = c.req.query("path") ?? "";

  if (!requestPath) return c.json({ error: "path required" }, 400);

  if (!await assertOwns(projectId, userId)) {
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
