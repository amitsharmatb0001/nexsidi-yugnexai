---
name: security-review
description: Use when reviewing an app with accounts for security — auth on every route, ownership checks, secrets and injection.
agents: [karan, tilotma]
keywords: [auth, login, sign in, password, api, token, jwt, private, privacy, security, user]
---

# Security review checklist

- Every data route requires a valid JWT; list each route that does not.
- Ownership: every query on a single record filters by id AND user_id
  (insecure direct object reference otherwise). Test with a second user.
- The user id is never taken from the body, query or URL.
- Passwords hashed with bcrypt (cost 10+); never logged or returned.
- JWT secret and database URL from the environment, never in the code.
- SQL uses parameters; no string-built queries with user input.
- CORS allows only the app's own frontend origin.
- Rate limit sign-in and sign-up.
- Errors do not leak stack traces or whether an email exists.
- Inputs validated on the server (see input-validation).
Report each finding with the file, line and the concrete request that shows the weakness.
