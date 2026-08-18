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

// 2026-08-17: real bug found live (gatherly1) — POST /api/chat is deliberately
// PUBLIC (app.ts: "planning happens before login") so it never runs
// authMiddleware, and the handler fell back to a hardcoded ANON_UUID
// unconditionally — even for a user who was genuinely signed in when they
// submitted the request. Every project built through onboarding was silently
// attributed to that anonymous placeholder, permanently invisible on the
// signed-in user's own dashboard (GET /api/projects correctly filters by the
// REAL userId). This resolves the real user from their session cookie when
// one is present, WITHOUT rejecting the request when it's absent — the "plan
// before you sign up" case this route intentionally supports stays working
// unchanged; only the "already logged in" case gets attributed correctly.
export async function resolveOptionalUserId(req: Request, fallback: string): Promise<string> {
  const token = sessionTokenFromRequest(req);
  if (!token) return fallback;
  const { authService } = await import("../auth/service.ts");
  const userId = await authService.userIdForSession(token);
  return userId ?? fallback;
}
