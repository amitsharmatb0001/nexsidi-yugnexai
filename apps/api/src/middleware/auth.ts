import type { MiddlewareHandler } from "hono";

// Validates Clerk JWT on all /api/* routes.
// Full Clerk SDK integration added in Phase 1 (requires @clerk/backend).
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  // TODO Phase 1: verify JWT with @clerk/backend verifyToken()
  await next();
};
