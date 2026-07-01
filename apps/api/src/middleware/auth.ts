import type { MiddlewareHandler } from "hono";
import { verifyToken } from "@clerk/backend";

// Validates Clerk JWT on all /api/* routes.
// Sets c.var.userId = Clerk user ID for downstream route handlers.
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const authorization = c.req.header("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const token = authorization.slice(7);
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env["CLERK_SECRET_KEY"] ?? "",
    });
    c.set("userId", payload.sub);
    await next();
  } catch {
    return c.json({ error: "unauthorized" }, 401);
  }
};
