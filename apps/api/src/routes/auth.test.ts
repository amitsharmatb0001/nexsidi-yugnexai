import { expect, test } from "bun:test";
import { Hono } from "hono";
import { createAuthRouter, type AuthService } from "./auth.ts";

function testApp(service: AuthService) {
  return new Hono().route("/api/auth", createAuthRouter(service));
}

test("sign-up creates a first-party session cookie", async () => {
  const app = testApp({
    signUp: async (email, password) => {
      expect(email).toBe("person@example.com");
      expect(password).toBe("correct horse battery staple");
      return { user: { id: "user-1", email }, token: "session-token" };
    },
    signIn: async () => null,
    signOut: async () => {},
    userIdForSession: async () => null,
  });

  const response = await app.request("/api/auth/sign-up", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: " Person@Example.com ", password: "correct horse battery staple" }),
  });

  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ user: { id: "user-1", email: "person@example.com" } });
  expect(response.headers.get("set-cookie")).toContain("nexsidi_session=session-token");
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
});

test("sign-in does not reveal whether an email exists", async () => {
  const app = testApp({
    signUp: async () => null,
    signIn: async () => null,
    signOut: async () => {},
    userIdForSession: async () => null,
  });

  const response = await app.request("/api/auth/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "unknown@example.com", password: "correct horse battery staple" }),
  });

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "invalid_credentials" });
});

test("sign-up rejects weak passwords before calling the persistence layer", async () => {
  let called = false;
  const app = testApp({
    signUp: async () => {
      called = true;
      return null;
    },
    signIn: async () => null,
    signOut: async () => {},
    userIdForSession: async () => null,
  });

  const response = await app.request("/api/auth/sign-up", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "person@example.com", password: "short" }),
  });

  expect(response.status).toBe(400);
  expect(called).toBe(false);
});

// GET /api/auth/me — the dashboard's account area needs the signed-in user's
// name/email, and this router is mounted BEFORE the app-wide auth middleware
// (sign-up must work with no session yet), so /me has to check the session
// itself rather than relying on c.get("userId") the way every other
// protected route does.

function testAppWithAccount(service: AuthService, getUserById: (id: string) => Promise<{ id: string; email: string; name: string } | null>) {
  return new Hono().route("/api/auth", createAuthRouter(service, getUserById));
}

test("GET /me returns 401 with no session cookie at all", async () => {
  const app = testApp({
    signUp: async () => null, signIn: async () => null, signOut: async () => {},
    userIdForSession: async () => null,
  });

  const response = await app.request("/api/auth/me");

  expect(response.status).toBe(401);
});

test("GET /me returns 401 when the session cookie doesn't resolve to a real user", async () => {
  const app = testApp({
    signUp: async () => null, signIn: async () => null, signOut: async () => {},
    userIdForSession: async () => null, // revoked/expired/garbage token
  });

  const response = await app.request("/api/auth/me", {
    headers: { cookie: "nexsidi_session=stale-token" },
  });

  expect(response.status).toBe(401);
});

test("GET /me returns the account for a genuinely valid session", async () => {
  const app = testAppWithAccount(
    {
      signUp: async () => null, signIn: async () => null, signOut: async () => {},
      userIdForSession: async (token) => (token === "real-token" ? "user-42" : null),
    },
    async (id) => (id === "user-42" ? { id: "user-42", email: "amit@yugnex.dev", name: "Amit" } : null),
  );

  const response = await app.request("/api/auth/me", {
    headers: { cookie: "nexsidi_session=real-token" },
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ user: { id: "user-42", email: "amit@yugnex.dev", name: "Amit" } });
});

test("GET /me returns 401 if the session is valid but the user row is gone (deleted account)", async () => {
  const app = testAppWithAccount(
    {
      signUp: async () => null, signIn: async () => null, signOut: async () => {},
      userIdForSession: async () => "user-orphaned",
    },
    async () => null,
  );

  const response = await app.request("/api/auth/me", {
    headers: { cookie: "nexsidi_session=some-token" },
  });

  expect(response.status).toBe(401);
});
