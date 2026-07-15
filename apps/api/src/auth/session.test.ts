import { expect, test } from "bun:test";
import {
  createSessionToken,
  hashSessionToken,
  sessionCookieOptions,
  sessionTokenFromRequest,
} from "./session.ts";

test("session tokens are unguessable URL-safe values and are only persisted as hashes", () => {
  const token = createSessionToken();

  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(hashSessionToken(token)).toMatch(/^[a-f0-9]{64}$/);
  expect(hashSessionToken(token)).not.toBe(token);
  expect(hashSessionToken(token)).toBe(hashSessionToken(token));
});

test("production session cookies are HttpOnly, Secure, and same-site", () => {
  expect(sessionCookieOptions("production")).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
  });
  expect(sessionCookieOptions("development").secure).toBe(false);
});

test("reads only the named session cookie from a request", () => {
  const request = new Request("https://app.example.test/api/projects", {
    headers: { cookie: "other=value; nexsidi_session=session-token; ignored=yes" },
  });

  expect(sessionTokenFromRequest(request)).toBe("session-token");
});
