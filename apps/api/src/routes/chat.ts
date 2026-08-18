// POST /api/chat — streaming chat with the Generic Planner Agent
// Uses Server-Sent Events so the UI can render tokens as they arrive.
//
// The planner conducts conversational discovery, then calls trigger_build
// (a function tool) when it has enough information to start the pipeline.
//
// Request:  { message: string, sessionId: string }
// Response: SSE stream of StreamChunk JSON objects

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { loadSession, saveSession, newSession } from "../../../../agents/planner/src/session.ts";
import { streamReply } from "../../../../agents/planner/src/index.ts";
import { startProjectBuild } from "../utils/temporal.ts";
import { db, projects } from "@nexsidi/db";
import { eq } from "drizzle-orm";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "node:crypto";
import { resolveOptionalUserId } from "../middleware/auth.ts";
import type { PlannerState, BuildPlan, ProposedPlan } from "../../../../agents/planner/src/types.ts";

// Ensure project IDs fit the varchar(12) DB column — hash anything longer
function normalizeProjectId(raw: string): string {
  if (raw.length <= 12 && /^[a-z0-9]+$/.test(raw)) return raw;
  return createHash("sha256").update(raw).digest("hex").slice(0, 12);
}

export const chatRouter = new Hono();

const BUILD_DIR = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";

// ── POST /api/chat — send a message and receive streaming reply ───────────────
// Stable UUID for unauthenticated users — DB userId column requires UUID format
const ANON_UUID = "00000000-0000-0000-0000-000000000000";

chatRouter.post("/", async (c) => {
  const userId = await resolveOptionalUserId(c.req.raw, ANON_UUID);
  const apiKey = process.env.NIM_API_KEY ?? "";

  const body = await c.req.json<{ message: string; sessionId: string }>();
  const { message, sessionId } = body;

  if (!message?.trim())   return c.json({ error: "message required" }, 400);
  if (!sessionId?.trim()) return c.json({ error: "sessionId required" }, 400);

  const state = (await loadSession(sessionId)) ?? newSession(userId, sessionId);
  state.messages.push({ role: "user", content: message.trim(), ts: Date.now() });

  return streamSSE(c, async (stream) => {
    let assistantContent    = "";
    let triggeredProjectId: string | null = null;
    let triggeredBuildPlan: BuildPlan | null = null;
    let streamFailed = false;

    try {
      for await (const chunk of streamReply(state, apiKey)) {
        // Normalize projectId in build_triggered before forwarding to client
        const outChunk = (chunk.type === "build_triggered" && chunk.projectId)
          ? { ...chunk, projectId: normalizeProjectId(chunk.projectId) }
          : chunk;
        await stream.writeSSE({ data: JSON.stringify(outChunk) });

        if (chunk.type === "token" && chunk.content) {
          assistantContent += chunk.content;
        }

        if (chunk.type === "elicitation_question" && chunk.elicitationQuestion) {
          // Persist ONE assistant message with both text (if any) AND tool_calls — the correct OpenAI format.
          // Two consecutive assistant messages would be invalid; one combined message is correct.
          const callId = chunk.elicitationCallId ?? `call_ask_${Date.now()}`;
          const args   = chunk.elicitationArgs   ?? JSON.stringify(chunk.elicitationQuestion);
          state.messages.push({
            role: "assistant",
            content: assistantContent.trim() || null,  // text preamble (if any) + null if none
            ts: Date.now(),
            tool_calls: [{ id: callId, type: "function", function: { name: "ask_user", arguments: args } }],
          });
          state.messages.push({
            role: "tool", content: "Question shown to user as an interactive widget. Waiting for their answer.",
            ts: Date.now(), tool_call_id: callId, name: "ask_user",
          });
          assistantContent = ""; // already saved above — don't double-push in the finally block
        }

        if (chunk.type === "plan_proposed" && chunk.proposedPlan) {
          const plan = chunk.proposedPlan;
          // Bug 2 fix: persist the full ProposedPlan so the trigger_build fast-path can
          // convert it directly without relying on LLM reconstruction from a thin summary.
          state.proposedPlan = plan;
          assistantContent = `Plan ready for ${plan.appName} — ${plan.publicPages.length + plan.protectedPages.length} pages, ${plan.apiEndpoints.length} endpoints, auth: ${plan.techStack.auth}.`;
        }

        if (chunk.type === "build_triggered" && chunk.projectId && chunk.buildPlan) {
          triggeredProjectId = normalizeProjectId(chunk.projectId);
          triggeredBuildPlan = chunk.buildPlan;
        }

        if (chunk.type === "error") {
          streamFailed = true;
        }
      }
    } catch (err) {
      streamFailed = true;
      await stream.writeSSE({
        data: JSON.stringify({ type: "error", content: "Something went wrong. Please try again." }),
      });
      console.error("[chat] stream error", err);
    }

    // When the planner calls trigger_build, write build-plan.json and start the pipeline
    if (triggeredProjectId && triggeredBuildPlan && !streamFailed) {
      try {
        state.phase = "building";
        state.projectId = triggeredProjectId;
        state.buildPlan = triggeredBuildPlan;

        // Write build-plan.json so the pipeline can skip Saanvi/Arjun
        const projectDir = join(BUILD_DIR, triggeredProjectId);
        mkdirSync(projectDir, { recursive: true });
        writeFileSync(
          join(projectDir, "build-plan.json"),
          JSON.stringify(triggeredBuildPlan, null, 2),
          "utf-8",
        );

        // Persist project to DB before pipeline start
        await db.insert(projects).values({
          id:        triggeredProjectId,
          userId,
          name:      triggeredBuildPlan.appName,
          status:    "building",
          createdAt: new Date(),
          updatedAt: new Date(),
        }).onConflictDoNothing();

        // Start the Temporal pipeline — workflow will detect build-plan.json and skip spec/decompose
        const userRequest = [
          triggeredBuildPlan.appName,
          triggeredBuildPlan.appDescription,
          ...triggeredBuildPlan.pages.map(p => `Page: ${p.name} (${p.path}) — ${p.description}`),
          ...(triggeredBuildPlan.designNotes ? [`\nDesign direction: ${triggeredBuildPlan.designNotes}`] : []),
        ].join("\n");

        await startProjectBuild(triggeredProjectId, userRequest);
        console.log(`[chat] pipeline started for project ${triggeredProjectId}`);
      } catch (err) {
        console.error("[chat] failed to start pipeline:", err);
      }
    }

    if (streamFailed) {
      // Rollback the last user message to avoid consecutive user messages in history
      state.messages.pop();
    } else {
      // Save clean assistant text (tool calls are not part of the conversation history)
      if (assistantContent.trim()) {
        state.messages.push({ role: "assistant", content: assistantContent.trim(), ts: Date.now() });
      }
    }

    await saveSession(state);
    await stream.writeSSE({ data: JSON.stringify({ type: "done" }) });
  });
});

// ── GET /api/chat/:sessionId — load conversation history ─────────────────────
chatRouter.get("/:sessionId", async (c) => {
  const state = await loadSession(c.req.param("sessionId"));
  if (!state) {
    // 2026-08-17: real bug found live (gatherly1) — PlannerState lives in an
    // in-memory Map (agents/planner/src/session.ts) with no persistence. ANY
    // api restart during an active build silently reverts this project's
    // page back to the empty "planning" chat view, even though the project
    // is genuinely mid-build (or done) on durable storage — the projects
    // table, and the Temporal workflow itself, are both completely
    // unaffected by an api restart. Falling back to the durable project
    // record when the ephemeral chat session is gone lets the page correctly
    // resume into the live build view instead of looking like the project
    // was never started. sessionId IS the project id for every build that
    // has actually been triggered (see normalizeProjectId above).
    const [project] = await db
      .select({ id: projects.id, status: projects.status })
      .from(projects)
      .where(eq(projects.id, c.req.param("sessionId")))
      .limit(1);
    if (project) {
      return c.json({
        messages:  [],
        phase:     project.status === "done" ? "done" : "building",
        projectId: project.id,
        buildPlan: null,
      });
    }
    return c.json({ messages: [], phase: "planning", projectId: null });
  }
  // Return only display-safe messages — strip tool messages and tool_calls internal fields.
  // The planner uses state.messages (full) for context; the web app only needs text content.
  const displayMessages = state.messages
    .filter(m => m.role === "user" || (m.role === "assistant" && m.content?.trim()))
    .map(m => ({ role: m.role, content: m.content, ts: m.ts }));
  return c.json({
    messages:  displayMessages,
    phase:     state.phase,
    projectId: state.projectId,
    buildPlan: state.buildPlan,
  });
});

// ── POST /api/chat/attachment — upload a file and return a text summary ───────
chatRouter.post("/attachment", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return c.json({ error: "file required" }, 400);

    const text = await file.text();
    // Return first 2000 chars as inline context; images return a placeholder
    const isText = file.type.startsWith("text/") || /\.(md|json|csv|txt)$/.test(file.name);
    const summary = isText
      ? text.slice(0, 2000) + (text.length > 2000 ? "\n…(truncated)" : "")
      : `[Binary file: ${file.name}, ${file.type}, ${Math.round(file.size / 1024)}KB — describe what you want to do with it]`;

    return c.json({ summary });
  } catch (err) {
    console.error("[attachment] error", err);
    return c.json({ error: "upload failed" }, 500);
  }
});
