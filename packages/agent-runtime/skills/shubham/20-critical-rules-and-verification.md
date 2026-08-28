CRITICAL RULES:
1. SQL: use $1, $2 placeholders — NEVER string interpolation
2. Route params: always name them (req: Request, res: Response) — NEVER rename "res"
3. SQL column names: valid SQL only — NEVER put random text inside SQL strings
4. IDOR: always filter by userId — WHERE id = $1 AND user_id = $2
5. Timestamps: use SQL DEFAULT now() — not app code
6. dueDate: always string | null (ISO 8601) — NEVER Date object
7. Add BOTH router.put("/:id") AND router.patch("/:id") for update endpoints
8. Available packages: express, jsonwebtoken, bcryptjs, pg, cors, helmet, dotenv, zod, express-rate-limit
   USE ONLY these — no other packages
9. Dynamic UPDATE queries (partial updates — only SOME fields provided) are
   where SQL injection actually happens in practice, even when rule 1 is
   followed for simple queries. Build the SET clause and the params array
   TOGETHER with a running index — the placeholder NUMBER goes in the
   query string (that's just text: "$1", "$2"...), the VALUE always goes
   in the params array, NEVER in the string:
   ---
   const fields: string[] = [];
   const values: unknown[] = [];
   let i = 1;
   if (updates.title !== undefined) { fields.push("title = $" + i++); values.push(updates.title); }
   if (updates.dueDate !== undefined) { fields.push("due_date = $" + i++); values.push(updates.dueDate); }
   values.push(taskId, userId);
   const query = "UPDATE tasks SET " + fields.join(", ") + " WHERE id = $" + i++ + " AND user_id = $" + i + " RETURNING *";
   await pool.query(query, values);
   ---
   The "$" + i above generates the placeholder NUMBER as text — that is
   not string interpolation of user data. If you ever put taskId, userId,
   or any request-body value directly inside the query string itself
   (via template-literal interpolation or string concatenation of the
   VALUE, not the placeholder number), that is the exact bug this rule
   exists to prevent.
10. CSRF middleware must actually validate the token against a stored/
    session value — not just check that a token header is present. If you
    write a placeholder comment like "In production, validate against a
    stored value", that is not done — implement the real check or omit
    the check entirely and say so in your summary.
11. UPDATE/DELETE by id: do NOT run a separate SELECT to check the row
    exists before the UPDATE/DELETE query. That's a check-then-act race
    (the row can be deleted between your two queries — result.rows[0] is
    then undefined and formatTask(result.rows[0]) throws) AND a wasted DB
    round-trip. Do the existence check and the mutation in ONE query using
    RETURNING, and branch on whether any row came back:
    ---
    const result = await pool.query(
      "UPDATE tasks SET " + fields.join(", ") + " WHERE id = $" + i++ + " AND user_id = $" + i + " RETURNING *",
      values,
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json(formatTask(result.rows[0]));
    ---
    Same pattern for DELETE: "DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id", check rows.length === 0 for 404, no separate existence SELECT first.
12. Validate EVERY value from req.params and req.body BEFORE using it —
    an unvalidated value that reaches the DB driver or a Date constructor
    throws an uncaught exception, returning a 500 instead of a proper 400.
    Two specific cases that WILL be tested:
    - Any :id route param used in a SQL query (task id, etc.) must match
      a UUID shape before it reaches pool.query — reject early with 400 if
      it does not match this pattern: ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ (case-insensitive).
      Use a regex test against req.params.id and respond 400 with an error
      body before the id ever reaches pool.query — an invalid UUID
      reaching Postgres throws driver error 22P02, an uncaught 500, not a
      clean 400.
    - Any date string from req.body (e.g. dueDate) must be validated
      before calling .toISOString() on it. new Date("not-a-date") is NOT
      null and NOT undefined — it is an Invalid Date object, and calling
      .toISOString() on it throws RangeError. Convert the value to a Date,
      check whether getTime() is NaN, and return 400 if so, BEFORE calling
      toISOString() anywhere on that value.
13. requireAuth middleware: do NOT add an in-memory cache (Map, object,
    etc.) of Clerk user lookups. It is not needed at this app's scale, and
    it is a real bug magnet: a cache with no expiry serves a stale/
    placeholder email forever after the user's real Clerk profile
    changes, and in-memory state is per-process, so it silently
    desyncs across multiple instances. Just call Clerk's API (or query
    the DB) directly on every request — a straightforward getAuth() +
    DB upsert with no caching layer is correct, simpler, and exactly
    what this app needs. Do not add caching here unless the task
    explicitly asks for it.

14. ADMIN-ONLY APPS MUST SEED THEIR ADMIN ACCOUNT — otherwise you ship a
    locked door with no key.
    2026-08-27: real bug found live (project 852be5aeaef4). The spec had
    sign-in but deliberately NO public registration (a private admin portal —
    the correct design for "the company can log in and manage leads"). Nothing
    ever created an admin row, and with no sign-up endpoint there was no way
    to create one. The delivered app's entire admin area — leads dashboard AND
    content editor, the whole reason the user asked for auth at all — was
    permanently unreachable. The ONLY user in the delivered database was a
    throwaway row left behind by deploy-time CRUD verification, which is both
    useless as a login (random password) and a security problem (it carried
    role "admin").
    When spec.auth is present and there is NO registration endpoint, you MUST
    seed exactly one admin account at server startup:
    - Read ADMIN_EMAIL and ADMIN_PASSWORD from process.env. If either is
      missing, generate a strong random password, use a sensible default
      email (e.g. admin@localhost), and console.log the credentials ONCE at
      startup so the operator can actually log in. Never hardcode a password
      in source.
    - Idempotent: check whether an admin already exists first and do nothing
      if so. This runs on every boot — it must not fail or duplicate on the
      second start.
    - Hash the password with bcryptjs exactly like the sign-in path expects —
      the seeded row must actually authenticate through your real login
      endpoint, not just exist in the table.
    - Put this in its own module (e.g. src/db/seedAdmin.ts) called from
      startup, not inline in a route handler.
    Verify it for real: after `docker_compose up`, http_request POST your own
    sign-in endpoint with the seeded credentials and confirm it returns a
    token. A seed you never logged in with is a seed you never verified.

SELF-VERIFICATION PROTOCOL — you are a senior engineer, not a code spitter.
Do NOT call task_complete until you have PROVEN your code works, with real
command output as evidence. Verify in this order and report what you actually ran:

HARD GATE (must pass — these are reliable and required):
  a) run_command "npm install" — exits 0.
  b) run_command "npx tsc --noEmit" — exits 0 (fix every type error; do not
     suppress with an any-cast or a ts-ignore comment).
  c) run_command "npm run build" — exits 0.

LIVE AUTH-BOUNDARY VERIFICATION (required whenever this app has ANY protected
route — skip only for a fully public API with zero requireAuth routes; if you
skip, say so explicitly in your task_complete summary and why):
  d) Write a minimal docker-compose.yml mapping Postgres to port 55432 on the
     host (NOT 5432 — native Postgres is already on 5432; wrong port =
     misleading auth errors) AND your own backend service, built from the
     Dockerfile already in this project (do not write a second one) mapped to
     a free host port. To load Pranav's EXISTING schema into this throwaway
     Postgres, mount the REAL migrations directory as Postgres's own native
     init directory — do NOT copy, recreate, or summarize the schema into a
     new file of your own (init.sql, schema.sql, or anything else): that
     creates a duplicate that silently drifts out of sync with Pranav's
     actual migrations the moment he adds an index or column, and QA will
     keep citing your stale copy forever even after the real schema is
     fixed. In your postgres service definition:
       volumes:
         - ../db/migrations:/docker-entrypoint-initdb.d:ro
     Postgres runs every .sql file in that directory once, in filename
     order, on first container startup — this is the standard postgres
     Docker image behavior, needs no script of your own, and is always the
     exact same file Pranav owns, never a copy. Start it with docker_compose
     up, then use http_request to PROVE — not assume — the auth boundary
     actually works, for EVERY protected/mutating route in your own
     api-contract (not just one — a route-by-route sweep, same as the FULL
     CRUD SELF-CHECK below):
       - Call each protected/mutating route with NO Authorization header.
         It MUST return 401/403 — if it returns 200/201 or a 500, that route
         is either missing requireAuth or crashing before the check runs;
         fix the actual code, do not adjust the test to match. A route you
         never actually called is a route you never actually verified — auth
         gaps hide on the ONE endpoint you didn't get around to testing.
       - Register or log in via your own auth endpoint to get a real token,
         then call the SAME route WITH that token. It must succeed.
       - If a route is intentionally public (e.g. the reservation/contact
         form this app's spec described as auth:false), confirm it still
         works with NO token — a public route silently requiring auth is
         also a bug, just the opposite direction.
     Tear down with docker_compose down when finished.
     Budget scales with route count — roughly 2 calls (no-token + with-token)
     per protected route, plus setup/teardown. This is NOT the same check QA
     does — Navya/Karan/Deepika read source text and infer whether a route
     looks protected; they have no http_request tool and cannot actually
     call it. This step is the only point in the entire pipeline that PROVES
     the auth boundary behaves as written, on the code you just wrote,
     before anyone else ever sees it.
     2026-08-06: a prior version of this protocol started the Express server
     natively on the host and was removed after repeated Windows server-start
     failures burned 7+ iterations per run. Running the server inside Docker
     instead (the same mechanism Riya's real deploy already uses successfully)
     avoids that specific failure mode — this is not the same approach,
     don't assume it has the same problem.

FULL CRUD SELF-CHECK (required whenever this app has more than one resource
with a create endpoint — reuse the SAME throwaway environment from the
auth-boundary check above, don't tear down and rebuild):
  e) For EVERY resource in your own api-contract (not just the one route you
     already tested above), use http_request AND db_query to actually
     exercise it — a status code alone proves nothing; you must look at
     what actually happened to the DATA:
       - POST a real create. A 200/201 is NOT enough — use db_query to
         SELECT the row by the id the response returned and confirm it's
         REALLY there with the fields you sent. A response that claims
         success while the row was never actually inserted is a real,
         serious bug (this exact failure mode has shipped before: an
         endpoint returning a plausible id while the INSERT silently never
         landed). If a resource depends on another (e.g. a booking needs a
         real session_id), fetch that dependency's real id from its own GET
         list endpoint first — never send a guessed/placeholder id.
       - GET the list endpoint. Don't just check the new record's id is
         present — read the actual response BODY and confirm the field
         VALUES match what you sent (name, price, whatever you posted) —
         a list endpoint can include the right id with stale or wrong field
         data and still look "present" at a glance.
       - If a PATCH/PUT endpoint exists, call it with a real field change,
         then db_query (not just a follow-up GET, which could be serving
         cached/stale data) to confirm the DATABASE ROW actually changed —
         not just that the HTTP response was 200.
       - If a DELETE endpoint exists AND no other resource in this same
         api-contract references this resource via an "_id" field (e.g.
         skip deleting "classes" if "sessions" has a class_id field) — call
         it, then db_query to confirm the row is actually gone. Deleting a
         resource that something else in your OWN sweep still needs to
         reference will falsely break that OTHER resource's create step
         with a missing-foreign-key error that has nothing to do with a
         real bug — this exact self-inflicted mistake was found and fixed
         live in Riya's own equivalent post-deploy checker; don't reintroduce
         it here. When in doubt, just skip the delete check for that
         resource — update/create/read coverage is not lost by skipping it.
     A 403 here is not a failure IF it's because your own role-based access
     control correctly rejected the account you're testing with (e.g. a
     plain customer account trying to create an admin-only resource) — that
     PROVES your authorization code works. Only a 500, a silently-missing
     write, a response body with wrong data, or a create/update/delete that
     doesn't actually change the database is a real finding you must fix
     before claiming done.
     This is the same class of check Riya's post-deploy CRUD verification
     does later — the entire point of doing it HERE is that you already
     have full context on the code you just wrote, so a bug caught now costs
     one extra tool call; the identical bug caught at deploy time costs a
     full deploy-review-report-refix-redeploy cycle instead.
     Budget scales with resource count: roughly 4-5 tool calls per resource
     (create, db_query-verify, read-back, update if it exists, delete if it
     exists and nothing depends on it) plus the auth-boundary check's own
     budget above.

PRODUCTION SECURITY — this app may be hosted publicly on day 0; it must not be
trivially hacked. Beyond the SQL/IDOR/validation rules above, ensure ALL of:
  - helmet() enabled; CORS restricted to CORS_ORIGIN (never "*").
  - express-rate-limit on auth-sensitive / write routes.
  - EVERY mutating/protected route goes through requireAuth; no route is
    accidentally public.
  - Request bodies validated (zod or explicit checks) BEFORE use; reject
    unexpected/oversized input with 400, never let it reach the DB/Date/etc.
  - Errors return a generic message + correct status — NEVER leak stack traces,
    SQL, or internal paths to the client. No secrets/keys hardcoded in source.
  - No debug endpoints, no console.log of secrets, no permissive defaults.

Call task_complete with verification_passed: true ONLY after the HARD GATE
passes; include in your summary exactly what live verification (d-f) and
security checks you completed and their results. If the HARD GATE cannot pass
after 5 real attempts, call task_complete with verification_passed: false and
explain precisely what failed.
