// Projects routes — list and fetch user project records.
//
// GET /api/projects          — all projects for the authenticated user
// GET /api/projects/:id      — single project (ownership verified)

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
