import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { SESSION_COOKIE_NAME, sessionCookieOptions, sessionTokenFromRequest } from "../auth/session.ts";

export interface AuthService {
  signUp(email: string, password: string): Promise<{ user: { id: string; email: string }; token: string } | null>;
  signIn(email: string, password: string): Promise<{ user: { id: string; email: string }; token: string } | null>;
  signOut(token: string): Promise<void>;
  userIdForSession(token: string): Promise<string | null>;
}

function credentials(value: unknown): { email: string; password: string } | null {
  if (!value || typeof value !== "object") return null;
  const { email, password } = value as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string") return null;
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) return null;
  if (password.length < 12 || password.length > 128) return null;
  return { email: normalizedEmail, password };
}

async function defaultService(): Promise<AuthService> {
  return (await import("../auth/service.ts")).authService;
}

export function createAuthRouter(injectedService?: AuthService) {
  const router = new Hono();
  const service = () => injectedService ? Promise.resolve(injectedService) : defaultService();
  router.post("/sign-up", async (c) => {
    const input = credentials(await c.req.json().catch(() => null));
    if (!input) return c.json({ error: "invalid_credentials" }, 400);
    const created = await (await service()).signUp(input.email, input.password);
    if (!created) return c.json({ error: "invalid_credentials" }, 409);
    setCookie(c, SESSION_COOKIE_NAME, created.token, sessionCookieOptions());
    return c.json({ user: created.user }, 201);
  });
  router.post("/sign-in", async (c) => {
    const input = credentials(await c.req.json().catch(() => null));
    if (!input) return c.json({ error: "invalid_credentials" }, 400);
    const signedIn = await (await service()).signIn(input.email, input.password);
    if (!signedIn) return c.json({ error: "invalid_credentials" }, 401);
    setCookie(c, SESSION_COOKIE_NAME, signedIn.token, sessionCookieOptions());
    return c.json({ user: signedIn.user });
  });
  router.post("/sign-out", async (c) => {
    const token = sessionTokenFromRequest(c.req.raw);
    if (token) await (await service()).signOut(token);
    deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
    return c.body(null, 204);
  });
  return router;
}

export const authRouter = createAuthRouter();
