// Projects routes — list, fetch, rename and delete a user's project records.
//
// GET    /api/projects       — all projects for the authenticated user
// GET    /api/projects/:id   — single project (ownership verified)
// PATCH  /api/projects/:id   — rename (ownership verified)
// DELETE /api/projects/:id   — remove the project record (ownership verified)

import { Hono } from "hono";
import { db, projects } from "@nexsidi/db";
import { and, desc, eq } from "drizzle-orm";

type Env = { Variables: { userId: string } };
export const projectsRouter = new Hono<Env>();

// ── GET /api/projects ─────────────────────────────────────────────────────────
projectsRouter.get("/", async (c) => {
  const userId = c.get("userId") as string;

  const rows = await db
    .select({
      id:         projects.id,
      name:       projects.name,
      status:     projects.status,
      appUrl:     projects.appUrl,
      githubRepo: projects.githubRepo,
      iteration:  projects.iteration,
      createdAt:  projects.createdAt,
      updatedAt:  projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt));

  return c.json({ projects: rows });
});

// ── GET /api/projects/:id ─────────────────────────────────────────────────────
projectsRouter.get("/:id", async (c) => {
  const userId    = c.get("userId") as string;
  const projectId = c.req.param("id");

  const [row] = await db
    .select({
      id:         projects.id,
      name:       projects.name,
      status:     projects.status,
      appUrl:     projects.appUrl,
      githubRepo: projects.githubRepo,
      iteration:  projects.iteration,
      createdAt:  projects.createdAt,
      updatedAt:  projects.updatedAt,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);

  if (!row) return c.json({ error: "not_found" }, 404);

  return c.json(row);
});

// ── PATCH /api/projects/:id ───────────────────────────────────────────────────
// Rename only, for now — the dashboard's inline "rename project" action.
projectsRouter.patch("/:id", async (c) => {
  const userId    = c.get("userId") as string;
  const projectId = c.req.param("id");

  const body = await c.req.json().catch(() => null) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "name_required" }, 400);
  if (name.length > 200) return c.json({ error: "name_too_long" }, 400);

  const [row] = await db
    .update(projects)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .returning({ id: projects.id, name: projects.name });

  if (!row) return c.json({ error: "not_found" }, 404);

  return c.json(row);
});

// ── DELETE /api/projects/:id ──────────────────────────────────────────────────
// Removes the project's DB record only — the dashboard's own list entry.
// Build output on disk (E:/tmp/nexsidi-builds/<id>) and any deployed
// containers are untouched: deleting those is a materially different,
// destructive action (frees a port, stops a live app, discards generated
// source) that a project-list "delete" click should not silently trigger
// alongside a rename-shaped request. If a follow-up wants full teardown,
// that belongs behind its own explicit, separately-confirmed action.
projectsRouter.delete("/:id", async (c) => {
  const userId    = c.get("userId") as string;
  const projectId = c.req.param("id");

  const [row] = await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .returning({ id: projects.id });

  if (!row) return c.json({ error: "not_found" }, 404);

  return c.body(null, 204);
});
