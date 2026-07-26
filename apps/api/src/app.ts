import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { healthRouter } from "./routes/health.ts";
import { webhooksRouter } from "./routes/webhooks.ts";
import { wsRouter } from "./routes/ws.ts";
import { chatRouter } from "./routes/chat.ts";
import { pipelineRouter } from "./routes/pipeline.ts";
import { projectsRouter } from "./routes/projects.ts";
import { artifactsRouter } from "./routes/artifacts.ts";
import { authRouter } from "./routes/auth.ts";
import { attachmentsRouter } from "./routes/attachments.ts";
import { authMiddleware } from "./middleware/auth.ts";

export const app = new Hono();

app.use("*", logger());
app.use("*", cors({ origin: process.env.WEB_URL ?? "http://localhost:3000", credentials: true }));

// Public routes
app.route("/health", healthRouter);
app.route("/webhooks", webhooksRouter);
app.route("/ws", wsRouter);              // Agent health WebSocket (internal — dev only)

app.route("/api/auth", authRouter);
// Protected routes
app.use("/api/*", async (c, next) => {
  const path = c.req.path;
  if (/^\/api\/pipeline\/[a-f0-9]+\/status$/.test(path)) return next();
  if (/^\/api\/pipeline\/[a-f0-9]+$/.test(path)) return next();
  if (/^\/api\/artifacts\/[a-f0-9]+\/tree$/.test(path)) return next();
  if (/^\/api\/artifacts\/[a-f0-9]+\/file/.test(path)) return next();
  if (/^\/api\/artifacts\/[a-f0-9]+\/build-plan\.json$/.test(path)) return next();
  // Approve-spec and approve-deploy are public — build page is reachable before login.
  // ProjectId in the URL scopes the action sufficiently for MVP.
  if (/^\/api\/pipeline\/[a-f0-9]+\/approve-spec$/.test(path) && c.req.method === "POST") return next();
  if (/^\/api\/pipeline\/[a-f0-9]+\/approve-deploy$/.test(path) && c.req.method === "POST") return next();
  // Chat is public — planning happens before login; handler falls back to "anonymous" userId
  if (/^\/api\/chat\/?$/.test(path) && c.req.method === "POST") return next();
  if (/^\/api\/chat\/[a-f0-9]+$/.test(path) && c.req.method === "GET") return next();
  return authMiddleware(c, next);
});
app.route("/api/chat", chatRouter);           // Planner: user-facing conversational agent
app.route("/api/pipeline", pipelineRouter);   // Pipeline trigger + status SSE
app.route("/api/projects", projectsRouter);   // Project list + single project fetch
app.route("/api/artifacts", artifactsRouter); // Browse + read generated build files
app.route("/api/attachments", attachmentsRouter); // File/folder/voice attachments handler

app.onError((err, c) => {
  console.error("[api] unhandled error", err);
  return c.json({ error: "internal_error" }, 500);
});

export type AppType = typeof app;
