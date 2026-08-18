import { test, expect } from "bun:test";
import { resolveOptionalUserId } from "./auth.ts";
import { SESSION_COOKIE_NAME } from "../auth/session.ts";
import { authService } from "../auth/service.ts";

const FALLBACK = "00000000-0000-0000-0000-000000000000";

function requestWithCookie(token?: string): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {},
  });
}

// 2026-08-17: real bug found live (gatherly1) — POST /api/chat is public (no
// authMiddleware) so it always fell back to a hardcoded anonymous userId,
// even for a user who was genuinely signed in at request time. Every project
// built via onboarding was silently attributed to that placeholder, invisible
// on the real user's own dashboard (GET /api/projects filters by real
// userId). resolveOptionalUserId must recognize a real, valid session without
// ever rejecting the request — the "plan before sign-up" case this route
// intentionally supports must keep working unchanged.

test("returns the fallback when no session cookie is present at all", async () => {
  const userId = await resolveOptionalUserId(requestWithCookie(undefined), FALLBACK);
  expect(userId).toBe(FALLBACK);
});

test("returns the fallback when the session cookie doesn't match any real session", async () => {
  const userId = await resolveOptionalUserId(requestWithCookie("not-a-real-token"), FALLBACK);
  expect(userId).toBe(FALLBACK);
});

test("returns the REAL signed-in user's id when a valid session cookie is present — the core fix", async () => {
  const email = `resolve-optional-${Date.now()}@example.com`;
  const created = await authService.signUp(email, "a-strong-password-123");
  if (!created) throw new Error("signUp failed in test setup");

  const userId = await resolveOptionalUserId(requestWithCookie(created.token), FALLBACK);

  expect(userId).toBe(created.user.id);
  expect(userId).not.toBe(FALLBACK);
});

test("falls back after sign-out — a revoked session must not resolve to the old user", async () => {
  const email = `resolve-optional-signout-${Date.now()}@example.com`;
  const created = await authService.signUp(email, "a-strong-password-123");
  if (!created) throw new Error("signUp failed in test setup");
  await authService.signOut(created.token);

  const userId = await resolveOptionalUserId(requestWithCookie(created.token), FALLBACK);

  expect(userId).toBe(FALLBACK);
});
