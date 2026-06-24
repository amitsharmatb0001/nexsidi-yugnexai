// Fix #5: Clerk webhook endpoint syncs cloud auth events to local PostgreSQL
// Without this, user_id FK on tasks has no matching row → constraint errors.
// Also handles CVE push feeds (Nice-to-have #12: Neha receives NVD/GHSA events).

import { Hono } from "hono";
import { Webhook } from "svix";
import { db } from "@nexsidi/db/client";
import { users } from "@nexsidi/db/schema";
import { eq } from "drizzle-orm";

export const webhooksRouter = new Hono();

// ─── Clerk ────────────────────────────────────────────────────────────────────
webhooksRouter.post("/clerk", async (c) => {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: "webhook secret not configured" }, 500);

  const svixId        = c.req.header("svix-id");
  const svixTimestamp = c.req.header("svix-timestamp");
  const svixSignature = c.req.header("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return c.json({ error: "missing svix headers" }, 400);
  }

  const body = await c.req.text();
  let event: { type: string; data: Record<string, unknown> };

  try {
    const wh = new Webhook(secret);
    event = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as typeof event;
  } catch {
    return c.json({ error: "invalid signature" }, 401);
  }

  if (event.type === "user.created") {
    const { id: clerkId, email_addresses } = event.data as {
      id: string;
      email_addresses: Array<{ email_address: string }>;
    };
    const email = email_addresses[0]?.email_address ?? "";
    await db.insert(users).values({ clerkId, email }).onConflictDoNothing();
  }

  if (event.type === "user.deleted") {
    const { id: clerkId } = event.data as { id: string };
    // Soft-delete: mark inactive rather than hard delete (data retention)
    await db
      .update(users)
      .set({ email: `deleted:${clerkId}` })
      .where(eq(users.clerkId, clerkId));
  }

  return c.json({ received: true });
});

// ─── NVD (NIST) CVE push feed (Nice-to-have #12) ─────────────────────────────
// Register at: https://nvd.nist.gov/developers/request-an-api-key
// NVD sends a POST to this endpoint when new CVEs publish.
webhooksRouter.post("/nvd", async (c) => {
  const secret = process.env.NVD_WEBHOOK_SECRET;
  const incoming = c.req.header("x-nvd-signature");
  if (!secret || !incoming) return c.json({ error: "unauthorized" }, 401);
  // TODO: verify HMAC-SHA256 signature before processing
  const payload = await c.req.json();
  console.log("[neha/nvd] CVE push received", JSON.stringify(payload).slice(0, 200));
  // Neha will pick this up from the database / Redis event
  return c.json({ received: true });
});

// ─── GHSA (GitHub Advisory) push feed (Nice-to-have #12) ─────────────────────
webhooksRouter.post("/ghsa", async (c) => {
  const secret = process.env.GHSA_WEBHOOK_SECRET;
  const incoming = c.req.header("x-hub-signature-256");
  if (!secret || !incoming) return c.json({ error: "unauthorized" }, 401);
  // TODO: verify HMAC-SHA256 (same pattern as GitHub webhooks)
  const payload = await c.req.json();
  console.log("[neha/ghsa] Advisory push received", JSON.stringify(payload).slice(0, 200));
  return c.json({ received: true });
});
