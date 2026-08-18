import { expect, test } from "bun:test";
import { Hono } from "hono";
import { db, projects } from "@nexsidi/db";
import { chatRouter } from "./chat.ts";

function testApp() {
  return new Hono().route("/api/chat", chatRouter);
}

// 2026-08-17: real bug found live (gatherly1) — PlannerState lives in an
// in-memory Map with no persistence (agents/planner/src/session.ts). Any api
// restart during an active build wiped the chat session, and GET /api/chat/
// :sessionId unconditionally fell back to { phase: "planning", projectId:
// null } — even for a project that was genuinely mid-build (or done) on
// durable storage. The build page reads this to decide whether to show the
// live workspace or the empty planning chat, so every restart silently
// reverted an in-progress build's page back to "never started". The fix
// falls back to the durable projects table (keyed by the same id — sessionId
// IS the project id for any build that was actually triggered) instead of
// assuming "planning".

test("GET /api/chat/:sessionId falls back to the durable project record when the in-memory session is gone, instead of assuming 'planning'", async () => {
  const projectId = `ct${Date.now().toString(36).slice(-10)}`;
  await db.insert(projects).values({
    id: projectId,
    userId: "00000000-0000-0000-0000-000000000000",
    name: "Chat Fallback Test",
    status: "building",
  });

  const app = testApp();
  const response = await app.request(`/api/chat/${projectId}`);
  const body = await response.json();

  expect(body.phase).toBe("building");
  expect(body.projectId).toBe(projectId);
  expect(body.messages).toEqual([]);

  await db.delete(projects).where(await import("drizzle-orm").then(m => m.eq(projects.id, projectId)));
});

test("GET /api/chat/:sessionId maps a 'done' project's status to phase 'done'", async () => {
  const projectId = `cd${Date.now().toString(36).slice(-10)}`;
  await db.insert(projects).values({
    id: projectId,
    userId: "00000000-0000-0000-0000-000000000000",
    name: "Chat Fallback Done Test",
    status: "done",
  });

  const app = testApp();
  const response = await app.request(`/api/chat/${projectId}`);
  const body = await response.json();

  expect(body.phase).toBe("done");

  await db.delete(projects).where(await import("drizzle-orm").then(m => m.eq(projects.id, projectId)));
});

test("GET /api/chat/:sessionId still returns 'planning' when neither a session NOR a project exists for this id — the genuinely-new-user case", async () => {
  const app = testApp();
  const response = await app.request("/api/chat/genuinely-nonexistent-id-xyz");
  const body = await response.json();

  expect(body).toEqual({ messages: [], phase: "planning", projectId: null });
});
