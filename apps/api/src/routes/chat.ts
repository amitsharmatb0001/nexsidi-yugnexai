// POST /api/chat — streaming chat with Maya (the user-facing conversational agent)
// Uses Server-Sent Events so the UI can render tokens as they arrive.
//
// Request:  { message: string, sessionId: string }
// Response: SSE stream of StreamChunk JSON objects

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { loadSession, saveSession, newSession } from "../../../../agents/maya/src/session.ts";
import { streamReply } from "../../../../agents/maya/src/index.ts";
import type { ChatMessage } from "../../../../agents/maya/src/types.ts";

export const chatRouter = new Hono();

chatRouter.post("/", async (c) => {
  // Auth: userId comes from verified Clerk JWT (middleware set it in context)
  // For Phase 0 stub we read from header directly — Phase 1 uses c.get("userId")
  const userId = c.req.header("x-user-id") ?? "anonymous";
  const apiKey = process.env.NIM_API_KEY ?? "";

  const body = await c.req.json<{ message: string; sessionId: string }>();
  const { message, sessionId } = body;

  if (!message?.trim()) return c.json({ error: "message required" }, 400);
  if (!sessionId?.trim()) return c.json({ error: "sessionId required" }, 400);

  // Load or create conversation state
  const state = (await loadSession(sessionId)) ?? newSession(userId, sessionId);

  // Append user message
  const userMsg: ChatMessage = { role: "user", content: message.trim(), ts: Date.now() };
  state.messages.push(userMsg);

  return streamSSE(c, async (stream) => {
    let assistantContent = "";

    try {
      for await (const chunk of streamReply(state, apiKey)) {
        await stream.writeSSE({ data: JSON.stringify(chunk) });

        if (chunk.type === "token" && chunk.content) {
          assistantContent += chunk.content;
        }
      }
    } catch (err) {
      await stream.writeSSE({
        data: JSON.stringify({ type: "error", content: "Something went wrong. Please try again." }),
      });
      console.error("[chat] stream error", err);
    }

    // Strip the __READY_TO_BUILD__ signal from what we save as assistant message
    const cleanContent = assistantContent
      .replace(/__READY_TO_BUILD__\{.*\}/s, "")
      .trim();

    if (cleanContent) {
      state.messages.push({ role: "assistant", content: cleanContent, ts: Date.now() });
    }

    await saveSession(state);
    await stream.writeSSE({ data: JSON.stringify({ type: "done" }) });
  });
});

// GET /api/chat/:sessionId — load existing conversation history
chatRouter.get("/:sessionId", async (c) => {
  const state = await loadSession(c.req.param("sessionId"));
  if (!state) return c.json({ messages: [], phase: "gathering" });
  return c.json({ messages: state.messages, phase: state.phase, projectId: state.projectId });
});
