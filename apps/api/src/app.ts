import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { healthRouter } from "./routes/health.ts";
import { webhooksRouter } from "./routes/webhooks.ts";
import { wsRouter } from "./routes/ws.ts";
import { authMiddleware } from "./middleware/auth.ts";

export const app = new Hono();

app.use("*", logger());
app.use("*", cors({ origin: process.env.WEB_URL ?? "http://localhost:3000", credentials: true }));

// Public routes
app.route("/health", healthRouter);
app.route("/webhooks", webhooksRouter);  // Fix #5: Clerk user sync
app.route("/ws", wsRouter);              // Nice-to-have #11: agent health dashboard

// Protected routes
app.use("/api/*", authMiddleware);

app.onError((err, c) => {
  console.error("[api] unhandled error", err);
  return c.json({ error: "internal_error" }, 500);
});

export type AppType = typeof app;
