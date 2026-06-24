import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { healthRouter } from "./routes/health.ts";
import { webhooksRouter } from "./routes/webhooks.ts";
import { wsRouter } from "./routes/ws.ts";
import { chatRouter } from "./routes/chat.ts";
import { pipelineRouter } from "./routes/pipeline.ts";
import { authMiddleware } from "./middleware/auth.ts";

export const app = new Hono();

app.use("*", logger());
app.use("*", cors({ origin: process.env.WEB_URL ?? "http://localhost:3000", credentials: true }));

// Public routes
app.route("/health", healthRouter);
app.route("/webhooks", webhooksRouter);  // Clerk user sync + CVE feeds
app.route("/ws", wsRouter);              // Agent health WebSocket (internal — dev only)

// Protected routes
app.use("/api/*", authMiddleware);
app.route("/api/chat", chatRouter);      // Maya: user-facing conversational agent
app.route("/api/pipeline", pipelineRouter); // Pipeline trigger + status SSE

app.onError((err, c) => {
  console.error("[api] unhandled error", err);
  return c.json({ error: "internal_error" }, 500);
});

export type AppType = typeof app;
