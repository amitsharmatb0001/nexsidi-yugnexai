---
name: express-api-structure
description: Use when writing or changing the generated app's Express + TypeScript backend — routes, controllers, errors, responses.
agents: [shubham]
keywords: [express, endpoint, endpoints, api, route, routes, backend, controller]
---

# Express API structure

## Layout
- src/index.ts starts the server; src/app.ts builds the app (middleware,
  routes, error handler).
- One router per resource in src/routes/<resource>.ts, mounted under
  /api/v1. ONE file per resource — never both clients.ts and
  clients.routes.ts (a real build shipped duplicates that drifted apart).
- Controllers in src/controllers/<resource>.ts; shared SQL in
  src/db/queries or services when two controllers need it.

## Responses
- Every response uses the envelope { success: boolean, data?: T, error?: string }.
- Status codes: 200 read/update, 201 created, 204 deleted (or 200 with
  data), 400 invalid input, 401 not signed in, 404 not found or not yours,
  409 conflict (duplicate), 500 unexpected.
- Wrap async handlers so a thrown error reaches the error middleware; the
  error middleware logs the error and returns { success: false, error:
  "Something went wrong" } — never a stack trace.

## Every endpoint in the contract exists
Implement exactly the method and path the API contract lists, including
PATCH and DELETE for things the user can edit or remove, and GET /:id for
detail pages. Check the contract again before calling the work done.
