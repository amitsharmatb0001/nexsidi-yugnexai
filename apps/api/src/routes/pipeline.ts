// Pipeline routes — trigger builds and stream status to the browser.
//
// POST /api/pipeline/start  — starts a project build workflow (called by chat route)
// GET  /api/pipeline/:projectId/status — SSE stream of pipeline stage updates
//
// Security Layer 7: all SSE events go through translateEvent() deny-by-default filter.
// Only whitelisted stage labels reach the browser — never agent names, scores, or errors.

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { startProjectBuild, getPipelineStatus, isWorkflowRunning } from "../utils/temporal.ts";
import { db, projects } from "@nexsidi/db";
import { eq } from "drizzle-orm";
import Redis from "ioredis";
import { randomUUID } from "crypto";

export const pipelineRouter = new Hono();

// ── Layer 7: deny-by-default stage translator ─────────────────────────────────
const USER_STAGE_MESSAGES: Record<string, string> = {
  spec:       "Getting started on your app...",
  decompose:  "Planning out the build...",
  generate:   "Writing your code. This usually takes 2-4 minutes.",
  qa:         "Running quality checks...",
  qa_fix:     "Improving the code based on quality checks...",
  live_test:  "Testing the live app...",
  deliver:    "Almost done — packaging everything up.",
  done:       "Your app is ready!",
  error:      "Something went wrong. We're on it.",
};

function translateStage(stage: string): { stage: string; message: string } | null {
  const message = USER_STAGE_MESSAGES[stage];
  if (!message) return null; // deny — unknown/internal stage
  return { stage, message };
}

// ── POST /api/pipeline/start ──────────────────────────────────────────────────
pipelineRouter.post("/start", async (c) => {
  const userId = c.get("userId") as string;
  const body   = await c.req.json<{ projectId: string; userRequest: string }>();
  const { projectId, userRequest } = body;

  if (!projectId?.trim()) return c.json({ error: "projectId required" }, 400);
  if (!userRequest?.trim()) return c.json({ error: "userRequest required" }, 400);

  // Check if already running — don't double-start
  const running = await isWorkflowRunning(projectId);
  if (running) return c.json({ projectId, status: "already_running" });

  // Persist project to DB (clerkId = Clerk user ID, stored as text for Phase 1)
  await db.insert(projects).values({
    id:        projectId,
    clerkId:   userId,
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

    const poll = async (): Promise<boolean> => {
      const state = await getPipelineStatus(projectId) as {
        stage?: string;
        iteration?: number;
      } | null;

      if (!state) {
        await stream.writeSSE({ data: JSON.stringify({ type: "waiting" }) });
        return false;
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

      return stage === "done" || stage === "error";
    };

    // Poll until done, error, or client disconnects
    let done = false;
    while (!done) {
      done = await poll();
      if (!done) await new Promise<void>((r) => setTimeout(r, 3_000));
    }

    await stream.writeSSE({ data: JSON.stringify({ type: "complete" }) });
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
