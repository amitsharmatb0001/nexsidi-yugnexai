import { expect, test } from "bun:test";
import { Hono } from "hono";
import { db, projects } from "@nexsidi/db";
import { chatRouter } from "./chat.ts";
import { saveSession } from "../../../../agents/planner/src/session.ts";

function testApp() {
  return new Hono().route("/api/chat", chatRouter);
}

// 2026-08-17: real bug found live (gatherly1) — GET /api/chat/:sessionId
// trusted the chat session's OWN self-reported phase unconditionally. A real,
// separate bug in trigger_build's flow left a session's stored phase stuck at
// "planning" even though it correctly started the Temporal workflow and
// inserted the projects row (confirmed live: the DB row and workflow both
// existed and progressed normally the whole time this session's phase never
// changed). The build page reads phase to decide whether to show the live
// workspace or the empty planning chat, so the stale value silently reverted
// an in-progress build's page back to "never started". The fix treats the
// projects table as authoritative for phase/projectId whenever a matching
// row exists — the chat session's own phase field is only trusted before a
// project exists at all (still mid-conversation).

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

test("GET /api/chat/:sessionId prefers the project's real status over a STALE session phase — the actual bug found live", async () => {
  const projectId = `cs${Date.now().toString(36).slice(-10)}`;
  // A session that genuinely exists but never got its phase updated past
  // "planning" — the exact real state observed live (Redis-backed, not
  // missing) for gatherly1 after trigger_build ran.
  await saveSession({
    userId: "00000000-0000-0000-0000-000000000000",
    sessionId: projectId,
    messages: [{ role: "user", content: "Build a marketplace", ts: Date.now() }],
    phase: "planning",
    projectId: null,
    buildPlan: null,
    proposedPlan: null,
  });
  await db.insert(projects).values({
    id: projectId,
    userId: "00000000-0000-0000-0000-000000000000",
    name: "Chat Stale Phase Test",
    status: "building",
  });

  const app = testApp();
  const response = await app.request(`/api/chat/${projectId}`);
  const body = await response.json();

  expect(body.phase).toBe("building");
  expect(body.projectId).toBe(projectId);
  // The real chat history should still come through even though phase is
  // sourced from the project record, not the session.
  expect(body.messages).toEqual([{ role: "user", content: "Build a marketplace", ts: body.messages[0].ts }]);

  await db.delete(projects).where(await import("drizzle-orm").then(m => m.eq(projects.id, projectId)));
});

test("GET /api/chat/:sessionId still returns 'planning' when neither a session NOR a project exists for this id — the genuinely-new-user case", async () => {
  const app = testApp();
  const response = await app.request("/api/chat/genuinely-nonexistent-id-xyz");
  const body = await response.json();

  expect(body).toEqual({ messages: [], phase: "planning", projectId: null });
});
