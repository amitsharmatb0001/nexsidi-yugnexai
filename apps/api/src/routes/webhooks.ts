import { Hono } from "hono";

export const webhooksRouter = new Hono();

webhooksRouter.post("/nvd", async (c) => {
  const secret = process.env.NVD_WEBHOOK_SECRET;
  if (!secret || !c.req.header("x-nvd-signature")) return c.json({ error: "unauthorized" }, 401);
  await c.req.json();
  return c.json({ received: true });
});

webhooksRouter.post("/ghsa", async (c) => {
  const secret = process.env.GHSA_WEBHOOK_SECRET;
  if (!secret || !c.req.header("x-hub-signature-256")) return c.json({ error: "unauthorized" }, 401);
  await c.req.json();
  return c.json({ received: true });
});
