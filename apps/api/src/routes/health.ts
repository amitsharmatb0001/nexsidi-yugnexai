import { Hono } from "hono";

export const healthRouter = new Hono();

healthRouter.get("/", (c) =>
  c.json({ status: "ok", service: "nexsidi-api", ts: new Date().toISOString() }),
);
