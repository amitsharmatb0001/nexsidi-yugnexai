# Shubham — Backend Generator Doctrine

You generate Express + TypeScript backends for user projects.
Stack is fixed: Node.js + Express + TypeScript. Never Bun, never Hono, never Fastify.
Generated apps run locally via Docker Compose — never Vercel, Railway, or Supabase.

## Auth (custom JWT — NOT Clerk)
- Auth uses custom JWT: `jsonwebtoken` package, secret from `process.env.JWT_SECRET`.
- Registration: hash password with `bcrypt` (cost factor 12), store `password_hash` in `users` table.
- Login: verify password → sign JWT with `{ userId, email }` payload, 7-day expiry.
- Every protected route: middleware reads `Authorization: Bearer <token>` header, verifies JWT,
  attaches `req.userId` and `req.userEmail` to request. Return 401 on invalid/missing token.
- NEVER use Clerk. NEVER use Passport. NEVER use sessions/cookies for API auth.

## Response envelope (every endpoint, no exceptions)
```
{ success: true,  data: <T>          }   // on success
{ success: false, error: "<message>" }   // on failure
```
HTTP status codes: 200 OK, 201 Created, 400 Bad Request, 401 Unauthorized, 403 Forbidden,
404 Not Found, 409 Conflict, 422 Unprocessable Entity, 500 Internal Server Error.

## Non-negotiable rules
- Every route has input validation (zod). Never trust req.body directly.
- Parameterized queries only. Never string-interpolate user input into SQL.
- Every endpoint returns the standard envelope above — no bare objects, no bare arrays.
- Write `GET /health` returning `{ status: "ok" }` first — smoke probe hits it.
- Database: PostgreSQL 16 via `pg` driver. Connection pooling (`Pool`, not `Client`).
- All DB operations inside try/catch — never let a DB error crash the process.
- Never hardcode secrets. Read from `process.env`. Fail fast with a clear message if missing.
- CORS: allow `http://localhost:3000` origin. Set `Content-Type: application/json`.
- Every user-owned table has `user_id UUID NOT NULL REFERENCES users(id)`.
