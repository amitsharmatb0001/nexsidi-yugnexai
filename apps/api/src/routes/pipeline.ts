// Pipeline routes — trigger builds and stream status to the browser.
//
// POST /api/pipeline/start  — starts a project build workflow (called by chat route)
// GET  /api/pipeline/:projectId/status — SSE stream of pipeline stage updates
//
// Security Layer 7: all SSE events go through translateEvent() deny-by-default filter.
// Only whitelisted stage labels reach the browser — never agent names, scores, or errors.

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { startProjectBuild, getPipelineStatus, isWorkflowRunning, getWorkflowStatus, sendWorkflowSignal } from "../utils/temporal.ts";
import { db, projects } from "@nexsidi/db";
import { eq } from "drizzle-orm";
import Redis from "ioredis";
import { randomUUID } from "crypto";
// Shared with routes/projects.ts — see utils/stage-labels.ts for why this
// must be the single copy.
import { translateStage } from "../utils/stage-labels.ts";

type Env = { Variables: { userId: string } };
export const pipelineRouter = new Hono<Env>();

// ── Layer 7: deny-by-default stage translator ──────────────────────────────

// ── POST /api/pipeline/start — INTERNAL ONLY ─────────────────────────────────
// The chat route triggers builds directly via startProjectBuild().
// This HTTP endpoint exists for testing/CLI only; requires x-nexsidi-internal header.
pipelineRouter.post("/start", async (c) => {
  const internalKey = c.req.header("x-nexsidi-internal");
  if (!internalKey || internalKey !== (process.env.INTERNAL_API_KEY ?? "dev-internal")) {
    return c.json({ error: "Not found" }, 404);
  }
  const userId = c.get("userId") as string;
  const body   = await c.req.json<{ projectId?: string; userRequest: string }>();
  const { userRequest } = body;
  // Schema: id = varchar(12). If caller provides one use it; else derive 12 hex chars from a UUID.
  const projectId = body.projectId?.trim() || randomUUID().replace(/-/g, "").slice(0, 12);

  if (!userRequest?.trim()) return c.json({ error: "userRequest required" }, 400);

  // Check if already running — don't double-start
  const running = await isWorkflowRunning(projectId);
  if (running) return c.json({ projectId, status: "already_running" });

  // Persist project to DB (clerkId = Clerk user ID, stored as text for Phase 1)
  await db.insert(projects).values({
    id:        projectId,
    userId,
    name:      `Project ${projectId.slice(0, 8)}`,
    status:    "building",
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();

  const workflowId = await startProjectBuild(projectId, userRequest);

  return c.json({ projectId, workflowId, status: "started" });
});

// ── GET /api/pipeline/:projectId/status — SSE pipeline status stream ──────────
// Polls Temporal workflow state every 3 seconds and streams translated stages.
// Closes automatically when the workflow reaches "done" or "error".
pipelineRouter.get("/:projectId/status", async (c) => {
  const projectId = c.req.param("projectId");
  if (!projectId) return c.json({ error: "projectId required" }, 400);

  return streamSSE(c, async (stream) => {
    let lastStage = "";

    const poll = async (): Promise<{ done: boolean; failed: boolean }> => {
      const state = await getPipelineStatus(projectId) as {
        stage?: string;
        iteration?: number;
      } | null;

      const workflowStatus = await getWorkflowStatus(projectId);

      // If no workflow runs at all, check database for historical state
      if (!workflowStatus) {
        return { done: true, failed: false };
      }

      // If workflow has terminated with failure
      if (workflowStatus !== "RUNNING" && workflowStatus !== "COMPLETED") {
        // Update DB status to failed
        try {
          await db.update(projects)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(projects.id, projectId));
        } catch (e) {
          console.error("[status-poll] failed to update db status:", e);
        }

        return { done: true, failed: true };
      }

      // If workflow is not active but finished successfully
      if (workflowStatus === "COMPLETED") {
        return { done: true, failed: false };
      }

      if (!state) {
        await stream.writeSSE({ data: JSON.stringify({ type: "waiting" }) });
        return { done: false, failed: false };
      }

      const stage = state.stage ?? "unknown";

      if (stage !== lastStage) {
        const translated = translateStage(stage);
        if (translated) {
          await stream.writeSSE({
            data: JSON.stringify({
              type:    "stage",
              stage:   translated.stage,
              message: translated.message,
            }),
          });
          lastStage = stage;
        }
      }

      // Send heartbeat so the connection stays alive
      await stream.writeSSE({ data: JSON.stringify({ type: "ping" }) });

      return { done: stage === "done" || stage === "error", failed: stage === "error" };
    };

    // Poll until done, error, or client disconnects
    let done = false;
    let failed = false;
    while (true) {
      const res = await poll();
      done = res.done;
      failed = res.failed;

      if (done) {
        if (failed) {
          await stream.writeSSE({
            data: JSON.stringify({
              type:    "stage",
              stage:   "error",
              message: "Execution failed. View system logs for details.",
            }),
          });
        } else {
          await stream.writeSSE({ data: JSON.stringify({ type: "complete" }) });
        }
        
        // Keep connection open to prevent client EventSource reconnect loop
        while (true) {
          await stream.writeSSE({ data: JSON.stringify({ type: "ping" }) });
          await new Promise<void>((r) => setTimeout(r, 15_000));
        }
      }
      await new Promise<void>((r) => setTimeout(r, 3_000));
    }
  });
});

// ── GET /api/pipeline/:projectId — fetch final project result ─────────────────
pipelineRouter.get("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) return c.json({ error: "not found" }, 404);

  return c.json({
    projectId:  project.id,
    name:       project.name,
    status:     project.status,
    appUrl:     project.appUrl    ?? null,
    githubRepo: project.githubRepo ?? null,
  });
});

// ── POST /api/pipeline/:projectId/approve-spec ────────────────────────────────
pipelineRouter.post("/:projectId/approve-spec", async (c) => {
  const projectId = c.req.param("projectId");
  try {
    await sendWorkflowSignal(projectId, "approveSpecSignal", true);
    return c.json({ success: true, message: "Spec approved. Code generation started." });
  } catch (err) {
    return c.json({ error: "Failed to signal workflow" }, 500);
  }
});

// ── POST /api/pipeline/:projectId/approve-deploy ──────────────────────────────
pipelineRouter.post("/:projectId/approve-deploy", async (c) => {
  const projectId = c.req.param("projectId");
  try {
    await sendWorkflowSignal(projectId, "approveDeploySignal", true);
    return c.json({ success: true, message: "Deployment approved. Delivery starting." });
  } catch (err) {
    return c.json({ error: "Failed to signal workflow" }, 500);
  }
});
