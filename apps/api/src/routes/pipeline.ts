// Pipeline routes — trigger builds and stream status to the browser.
//
// POST /api/pipeline/start  — starts a project build workflow (called by chat route)
// GET  /api/pipeline/:projectId/status — SSE stream of pipeline stage updates
//
// Security Layer 7: all SSE events go through translateEvent() deny-by-default filter.
// Only whitelisted stage labels reach the browser — never agent names, scores, or errors.

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { startProjectBuild, getPipelineStatus, isWorkflowRunning, getWorkflowStatus, sendWorkflowSignal, startChangeRequest } from "../utils/temporal.ts";
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
    // 2026-08-26: real bug found live (project 852be5aeaef4). getWorkflowStatus
    // returns null for BOTH "this workflow genuinely doesn't exist" and "we
    // couldn't reach Temporal just now" (it catches and returns null — see
    // utils/temporal.ts). A single transient miss — an API restart while a
    // browser tab is open, a Temporal client reconnect, a slow describe() —
    // used to immediately return done:true, which sends {type:"complete"}
    // and drops into the ping-forever loop below that NEVER polls stage
    // again. Confirmed live: the workflow sat at await_spec_approval with a
    // fully-written plan while the browser showed a frozen "Planning out the
    // build..." indefinitely, pings making the dead connection look healthy,
    // with no error anywhere. Requiring several CONSECUTIVE misses keeps the
    // real "no workflow" case working (it just takes ~15s to conclude) while
    // making a transient blip recoverable instead of permanently fatal.
    const MAX_CONSECUTIVE_LOOKUP_MISSES = 5;
    let consecutiveLookupMisses = 0;

    const poll = async (): Promise<{ done: boolean; failed: boolean }> => {
      const state = await getPipelineStatus(projectId) as {
        stage?: string;
        iteration?: number;
      } | null;

      const workflowStatus = await getWorkflowStatus(projectId);

      // No workflow reachable — could be genuinely absent, or a transient
      // lookup failure. Only conclude it's genuinely gone after several
      // consecutive misses (see MAX_CONSECUTIVE_LOOKUP_MISSES above).
      if (!workflowStatus) {
        consecutiveLookupMisses++;
        if (consecutiveLookupMisses >= MAX_CONSECUTIVE_LOOKUP_MISSES) {
          return { done: true, failed: false };
        }
        return { done: false, failed: false };
      }
      consecutiveLookupMisses = 0;

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
    // 2026-08-26: real gap found live — a project at "needs_review"/"failed"
    // had no queryable reason anywhere; see projects.failureReason's own
    // schema comment for the full writeup.
    failureReason: project.failureReason ?? null,
  });
});

// ── POST /api/pipeline/:projectId/approve-spec ────────────────────────────────
pipelineRouter.post("/:projectId/approve-spec", async (c) => {
  const projectId = c.req.param("projectId");
  // 2026-08-23: real bug found live (project a355bbb5fa35) — this route
  // never read the request body, so the "Approve with changes" text the
  // frontend sends as { changes } was silently discarded and every approval
  // behaved identically to a plain accept, regardless of what was typed.
  // A non-empty `changes` is signaled as approved=false (a rejection) with
  // the text attached — see approveSpecSignal's own header comment for why
  // this reuses the existing reject-and-redo loop instead of a new path.
  let changes: string | undefined;
  try {
    const body = await c.req.json();
    if (typeof body?.changes === "string" && body.changes.trim()) changes = body.changes.trim();
  } catch {
    // No body / not JSON — a plain approval, same as before.
  }
  try {
    if (changes) {
      await sendWorkflowSignal(projectId, "approveSpecSignal", false, changes);
      return c.json({ success: true, message: "Requested changes. Re-running the spec with your feedback." });
    }
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

// ── POST /api/pipeline/:projectId/request-changes — Workstream 3 ──────────────
// Root cause this closes: once a project is delivered there was no way back
// in at all — no composer, no route, nothing. The ORIGINAL workflow run has
// already completed by "done", so unlike approve-spec/approve-deploy above
// (which signal a still-RUNNING workflow) this starts a fresh
// applyChangeRequestWorkflow execution — see startChangeRequest's own header
// comment for why it's safe to reuse the same workflowId.
pipelineRouter.post("/:projectId/request-changes", async (c) => {
  const projectId = c.req.param("projectId");
  let changes = "";
  try {
    const body = await c.req.json();
    if (typeof body?.changes === "string") changes = body.changes.trim();
  } catch {
    // fall through to the empty-check below
  }
  if (!changes) return c.json({ error: "changes required" }, 400);

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return c.json({ error: "not found" }, 404);
  // Only a genuinely delivered project has generated code on disk for
  // applyChangeRequestActivity's runFix calls to target — appUrl (not
  // status, which nothing in the pipeline ever wrote before this
  // workstream — see markProjectDone's own header comment) is the one
  // signal that's actually reliable here.
  if (!project.appUrl) return c.json({ error: "project is not delivered yet" }, 409);

  const running = await isWorkflowRunning(projectId);
  if (running) return c.json({ error: "a build or change request is already in progress" }, 409);

  try {
    await db.update(projects).set({ status: "building", updatedAt: new Date() }).where(eq(projects.id, projectId));
    const workflowId = await startChangeRequest(projectId, changes);
    return c.json({ success: true, workflowId, message: "Applying your change request..." });
  } catch (err) {
    return c.json({ error: "Failed to start change request" }, 500);
  }
});

// ── POST /api/pipeline/:projectId/retry ────────────────────────────────────
// 2026-08-29: real gap found live (project 6c7d4358cf73) — a genuine
// transient failure (a machine-wide network outage took down every model in
// the Gemini pool simultaneously mid-generation) correctly escalated via
// escalateAndAwaitRetryDecision, which pauses the WORKFLOW on
// condition(() => retryDecision !== null, "24 hours") waiting for
// retryStageSignal. But nothing in apps/api or apps/web ever SENT that
// signal — the only prior instance of unblocking one of these was a
// hand-written one-off Temporal client script (pipeline/retry-rivhdw1.ts)
// committed for a single specific project. Every needs_review escalation
// with a retry-eligible reason was, in practice, a dead end for anyone
// without direct Temporal/shell access.
// Retry-eligible reasons are exactly the ones project-build.ts routes
// through escalateAndAwaitRetryDecision rather than an unconditional
// markProjectFailed+return: budget_exceeded, generation_failed, stuck_state,
// compile_repair_limit, deploy_stuck, deploy_failed. clarification_exhausted
// and spec_rejected_too_many_times are NOT here deliberately — the workflow
// already `return`ed for those; there is nothing left to signal, and this
// route 404s the underlying workflow lookup if attempted (see the running
// check below), rather than silently sending a signal into the void.
const RETRYABLE_FAILURE_REASONS = new Set([
  "budget_exceeded",
  "generation_failed",
  "stuck_state",
  "compile_repair_limit",
  "deploy_stuck",
  "deploy_failed",
]);

pipelineRouter.post("/:projectId/retry", async (c) => {
  const projectId = c.req.param("projectId");

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return c.json({ error: "not found" }, 404);
  if (project.status !== "needs_review") {
    return c.json({ error: "project is not awaiting a retry decision" }, 409);
  }
  if (!project.failureReason || !RETRYABLE_FAILURE_REASONS.has(project.failureReason)) {
    return c.json({ error: `failure reason "${project.failureReason ?? "unknown"}" is not retryable — this project needs a new build, not a retry` }, 409);
  }

  const running = await isWorkflowRunning(projectId);
  if (!running) {
    return c.json({ error: "the build workflow is no longer running — it may have already timed out waiting for a decision" }, 409);
  }

  try {
    await sendWorkflowSignal(projectId, "retryStageSignal", true);
    // The workflow's own state.stage will move off "await_spec_approval"-
    // style holding points once it resumes; setting "building" here closes
    // the same gap request-changes closes above — the DB should not still
    // say needs_review the instant a retry has been accepted.
    await db.update(projects).set({ status: "building", failureReason: null, updatedAt: new Date() }).where(eq(projects.id, projectId));
    return c.json({ success: true, message: "Retrying..." });
  } catch (err) {
    return c.json({ error: "Failed to send retry signal" }, 500);
  }
});
