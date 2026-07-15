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
