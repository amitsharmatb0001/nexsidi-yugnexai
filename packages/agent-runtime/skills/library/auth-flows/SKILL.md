---
name: auth-flows
description: Use when building sign-up, sign-in, sign-out or protected pages in the generated Next.js frontend with JWT cookies.
agents: [aanya, shubham, karan, tilotma]
keywords: [sign in, sign-in, signin, login, log in, sign up, sign-up, signup, register, sign out, logout, auth, jwt, password, protected]
---

# Auth flows (JWT in a cookie)

## Pages and redirects
- Sign-up success: go to sign-in (or straight in if the API returns a token).
- Sign-in success: set the token cookie, then
  window.location.assign("/dashboard"). NEVER router.push: the router reuses
  pages prefetched while signed out, so the user stays on the sign-in page.
- Sign-out: clear the cookie, then window.location.assign("/sign-in").
- middleware.ts sends signed-out visitors of protected pages to /sign-in and
  signed-in visitors of /sign-in or /sign-up to /dashboard.

## API calls
- Call the backend directly at process.env.NEXT_PUBLIC_API_URL from the
  browser. Never add a next.config rewrites() proxy for /api — it runs
  inside the container where localhost is the frontend itself.
- On a 401 from any call: clear the cookie and window.location.assign("/sign-in").

## Header
Signed in: the app's main destinations and Sign Out. Signed out: Sign In
and Get Started. Never both, never a static header.

## Backend
bcrypt (cost 10 or more) for passwords; the JWT secret from the
environment; sign-in errors say "Email or password is incorrect" without
revealing which; sign-up with an existing email returns 409.
A role is never read from the request: sign-up always creates the lowest role
(no role field in the body, not even optional). Staff or admin accounts come from
a seeded account or from someone who already holds that role; the role in a token
comes from the database row.
