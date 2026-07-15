import type { MiddlewareHandler } from "hono";
import { sessionTokenFromRequest } from "../auth/session.ts";

// Validates Clerk JWT on all /api/* routes.
// Sets c.var.userId = Clerk user ID for downstream route handlers.
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const token = sessionTokenFromRequest(c.req.raw);
  if (!token) return c.json({ error: "unauthorized" }, 401);
  const { authService } = await import("../auth/service.ts");
  const userId = await authService.userIdForSession(token);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", userId);
  await next();
};
