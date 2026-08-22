// Projects routes — create, list, fetch, rename and delete a user's project
// records.
//
// POST   /api/projects       — create a new project (name + context)
// GET    /api/projects       — all projects for the authenticated user
// GET    /api/projects/:id   — single project (ownership verified)
// PATCH  /api/projects/:id   — rename (ownership verified)
// DELETE /api/projects/:id   — remove the project record (ownership verified)

import { Hono } from "hono";
import { db, projects, tokenSpend } from "@nexsidi/db";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getPipelineStatus } from "../utils/temporal.ts";
import { translateStage } from "../utils/stage-labels.ts";

type Env = { Variables: { userId: string } };
export const projectsRouter = new Hono<Env>();

interface ProjectRow {
  id: string;
  name: string;
  status: string;
  appUrl: string | null;
  githubRepo: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Only present on the single-project fetch — the list view omits it to
   * keep every row response small regardless of how long a context runs. */
  context?: string | null;
}

/**
 * Attaches the real, deny-by-default pipeline stage and cost figures to a row.
 *
 * `iteration` is deliberately never selected by either route below — it was
 * previously returned in every list/detail response even though no screen
 * rendered it, which is exactly the kind of latent leak "no iteration count
 * to the user" means to close: a field absent from the UI can still be read
 * straight off the network response.
 *
 * Stage is only queried from Temporal while the project is actually building;
 * a finished or failed project has no running workflow to ask, and the two
 * failure states are unambiguous on their own.
 */
async function enrich(row: ProjectRow) {
  const [spend] = await db
    .select({
      costUsd: tokenSpend.totalCostUsd,
      tokensIn: tokenSpend.totalTokensIn,
      tokensOut: tokenSpend.totalTokensOut,
    })
    .from(tokenSpend)
    .where(eq(tokenSpend.projectId, row.id))
    .limit(1);

  let stage: string | null = null;
  let stageMessage: string;
  let needsApproval = false;

  if (row.status === "building") {
    const state = (await getPipelineStatus(row.id).catch(() => null)) as { stage?: string } | null;
    const translated = state?.stage ? translateStage(state.stage) : null;
    // A stage Temporal reports but the deny-by-default map doesn't recognize
    // must not leak as raw text — fall back to the same generic message the
    // "unknown status" branch below uses.
    stage = translated?.stage ?? null;
    stageMessage = translated?.message ?? "Working on it...";
    needsApproval = translated?.needsApproval ?? false;
  } else if (row.status === "done") {
    stage = "done";
    stageMessage = "Your app is ready!";
  } else if (row.status === "failed") {
    stage = "error";
    stageMessage = "Something went wrong. We're on it.";
  } else if (row.status === "planning") {
    stage = "planning";
    stageMessage = "Working out the plan…";
  } else {
    stageMessage = "Queued...";
  }

  return {
    id: row.id,
    name: row.name,
    status: row.status,
    appUrl: row.appUrl,
    githubRepo: row.githubRepo,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.context !== undefined ? { context: row.context } : {}),
    stage,
    stageMessage,
    needsApproval,
    costUsd: spend?.costUsd ?? "0",
    tokensIn: spend?.tokensIn ?? 0,
    tokensOut: spend?.tokensOut ?? 0,
  };
}

function newProjectId(): string {
  // Same scheme the client used to generate ids before this endpoint existed
  // (crypto.randomUUID, hyphens stripped, first 12 chars) — kept identical so
  // /api/chat's normalizeProjectId (which expects [a-z0-9]{1,12}) never has
  // to hash-fold an id this route produces.
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

// ── POST /api/projects ────────────────────────────────────────────────────────
// Creates the project row immediately, with a real name and its founding
// context — rather than the previous flow, where clicking "New project" only
// generated a client-side id and navigated to a page with no database row
// behind it at all. No row, no name, nothing in the project list existed
// until the planner finished the whole conversation and called
// trigger_build; an abandoned mid-chat project left no trace anywhere.
//
// `context` becomes the seed message the caller sends to POST /api/chat
// immediately after this returns (sessionId = the returned id) — this route
// itself does not talk to the planner, so a validation failure here can
// never leave a half-started chat session behind.
projectsRouter.post("/", async (c) => {
  const userId = c.get("userId") as string;

  const body = (await c.req.json().catch(() => null)) as { name?: unknown; context?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const context = typeof body?.context === "string" ? body.context.trim() : "";

  if (!name) return c.json({ error: "name_required" }, 400);
  if (name.length > 200) return c.json({ error: "name_too_long" }, 400);
  if (!context) return c.json({ error: "context_required" }, 400);
  if (context.length > 8000) return c.json({ error: "context_too_long" }, 400);

  // Collision odds on a 12-hex-char id are negligible (16^12), but the id is
  // also this project's primary key and its on-disk build directory name —
  // worth one real retry rather than a 500 on the one-in-trillions case.
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = newProjectId();
    const existing = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1);
    if (existing.length > 0) continue;

    await db.insert(projects).values({ id, userId, name, status: "planning", context });
    return c.json({ id, name }, 201);
  }

  return c.json({ error: "could_not_allocate_id" }, 500);
});

// ── GET /api/projects ─────────────────────────────────────────────────────────
projectsRouter.get("/", async (c) => {
  const userId = c.get("userId") as string;

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      appUrl: projects.appUrl,
      githubRepo: projects.githubRepo,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt));

  const enriched = await Promise.all(rows.map(enrich));
  return c.json({ projects: enriched });
});

// ── GET /api/projects/:id ─────────────────────────────────────────────────────
projectsRouter.get("/:id", async (c) => {
  const userId = c.get("userId") as string;
  const projectId = c.req.param("id");

  const [row] = await db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      appUrl: projects.appUrl,
      githubRepo: projects.githubRepo,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      context: projects.context,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);

  if (!row) return c.json({ error: "not_found" }, 404);

  return c.json(await enrich(row));
});

// ── PATCH /api/projects/:id ───────────────────────────────────────────────────
// Rename and/or update the project's own context — the dashboard's inline
// "rename project" action, and the IDE's Context panel, share this route.
// Both fields are optional and independent: saving a context edit must not
// require re-sending the name, and vice versa.
projectsRouter.patch("/:id", async (c) => {
  const userId    = c.get("userId") as string;
  const projectId = c.req.param("id");

  const body = await c.req.json().catch(() => null) as { name?: unknown; context?: unknown } | null;

  const set: { name?: string; context?: string; updatedAt: Date } = { updatedAt: new Date() };

  if (body?.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return c.json({ error: "name_required" }, 400);
    if (name.length > 200) return c.json({ error: "name_too_long" }, 400);
    set.name = name;
  }

  if (body?.context !== undefined) {
    const context = typeof body.context === "string" ? body.context.trim() : "";
    if (context.length > 8000) return c.json({ error: "context_too_long" }, 400);
    set.context = context;
  }

  if (set.name === undefined && set.context === undefined) {
    return c.json({ error: "nothing_to_update" }, 400);
  }

  const [row] = await db
    .update(projects)
    .set(set)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .returning({ id: projects.id, name: projects.name, context: projects.context });

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
