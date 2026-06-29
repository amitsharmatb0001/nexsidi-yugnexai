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
import { authMiddleware } from "./middleware/auth.ts";

export const app = new Hono();

app.use("*", logger());
app.use("*", cors({ origin: process.env.WEB_URL ?? "http://localhost:3000", credentials: true }));

// Public routes
app.route("/health", healthRouter);
app.route("/webhooks", webhooksRouter);  // Clerk user sync + CVE feeds
app.route("/ws", wsRouter);              // Agent health WebSocket (internal — dev only)

// Protected routes
// Note: pipeline status SSE and result GET are exempt — EventSource cannot send auth
// headers, and projectIds are unguessable 12-char hex strings (security by obscurity sufficient).
app.use("/api/*", async (c, next) => {
  const path = c.req.path;
  if (/^\/api\/pipeline\/[a-f0-9]+\/status$/.test(path)) return next();
  if (/^\/api\/pipeline\/[a-f0-9]+$/.test(path)) return next();
  return authMiddleware(c, next);
});
app.route("/api/chat", chatRouter);           // Maya: user-facing conversational agent
app.route("/api/pipeline", pipelineRouter);   // Pipeline trigger + status SSE
app.route("/api/projects", projectsRouter);   // Project list + single project fetch
app.route("/api/artifacts", artifactsRouter); // Browse + read generated build files

app.onError((err, c) => {
  console.error("[api] unhandled error", err);
  return c.json({ error: "internal_error" }, 500);
});

export type AppType = typeof app;
