import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { verifyLiveAuthenticatedRoundTrip, buildPayloadForRequestType, verifyAllResourceCrud, resolveForeignKeyId } from "./index.ts";

// Real gap found live (project=simple1, 2026-07-26): this check was written
// for Sprint 1's NexTech-style CRUD app (an authenticated POST resource
// shaped like {title}) and hard-FAILS any project whose locked spec never
// asked for one. simple1 is a legitimate coffee-shop site — sign-in/sign-up
// + a public contact form, no protected resource to create — and got stuck
// in Stage 6's deploy-retry loop forever because "no authenticated POST
// endpoint" was scored as a broken deploy rather than a feature the app
// never claimed to have. Violates the plan's own "build ANY site — nothing
// hardcoded to NexTech" rule (Phase 3.5b / D50).
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "riya-verify-auth-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeContract(endpoints: unknown[]) {
  writeFileSync(join(dir, "api-contract.json"), JSON.stringify({ endpoints }));
}

test("a project with no authenticated POST endpoint in its contract is not treated as a broken deploy", async () => {
  writeContract([
    { method: "POST", path: "/api/v1/auth/register", auth: false },
    { method: "POST", path: "/api/v1/auth/login", auth: false },
    { method: "POST", path: "/api/v1/contact", auth: false },
  ]);
  const result = await verifyLiveAuthenticatedRoundTrip(dir, "http://localhost:9999");
  expect(result.ok).toBe(true);
});

test("api-contract.json missing entirely is still a real failure (cannot discover endpoints at all)", async () => {
  const result = await verifyLiveAuthenticatedRoundTrip(dir, "http://localhost:9999");
  expect(result.ok).toBe(false);
});

// 2026-08-17: real bug found live (fulfillio1-deploy-resume-2) — a backend
// URL that's genuinely unreachable (nothing listening — the concrete case
// that happened live was a computed port mismatch, see getRunningDeployment-
// Ports' own header comment) made the raw fetch() inside
// registerAndLoginTestUser THROW instead of returning {error}, unlike every
// other failure path in that function (HTTP error status, missing token —
// all captured as a value). That uncaught throw propagated through
// verifyAllResourceCrud -> run() -> the Temporal activity -> the workflow,
// completely bypassing Stage 6's auto-retry/escalation logic (which only
// triggers on a normal {success:false} RETURN, never a thrown exception) and
// killing the whole workflow execution outright. This must resolve with a
// real { ok: false, reason } instead of rejecting.
test("verifyLiveAuthenticatedRoundTrip resolves with ok:false (not a thrown/rejected promise) when the backend URL is completely unreachable", async () => {
  writeContract([
    { method: "POST", path: "/api/v1/auth/register", auth: false },
    { method: "POST", path: "/api/v1/auth/login", auth: false },
    { method: "POST", path: "/api/v1/properties", auth: true },
  ]);
  // Bind a real server to grab a genuinely free port, then close it —
  // guarantees nothing is listening there, a real connection-refused case.
  const probe = createServer();
  const deadPort = await new Promise<number>((resolve) => {
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
  await new Promise<void>((resolve) => probe.close(() => resolve()));

  const result = await verifyLiveAuthenticatedRoundTrip(dir, `http://127.0.0.1:${deadPort}`);

  expect(result.ok).toBe(false);
  expect(result.reason.toLowerCase()).toContain("register");
});

// 2026-07-27 (live, complex1): real gap found live — this check registers a
// generic test user with NO role field, then picks the FIRST auth:true POST
// endpoint blindly. On a role-gated app (property creation restricted to
// landlord/staff), that test user correctly gets 403 Forbidden — the
// authorization is working exactly as designed. But `!createRes.ok` treated
// 403 identically to a real failure (500, network error), so a CORRECTLY
// secured deploy was reported as broken and retried into a stuck-state.
// A 403 specifically means "authenticated, but not authorized for this
// role" — proof the endpoint and its auth middleware both work, not
// evidence anything is broken.
let server: Server;
let serverUrl: string;
afterEach(() => { server?.close(); });

function startMockBackend(createStatus: number, createBody: unknown): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/api/v1/auth/register" && req.method === "POST") {
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } else if (req.url === "/api/v1/auth/login" && req.method === "POST") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ token: "fake-jwt-token" }));
        } else if (req.url === "/api/v1/properties" && req.method === "POST") {
          res.writeHead(createStatus, { "Content-Type": "application/json" });
          res.end(JSON.stringify(createBody));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

test("a 403 Forbidden from a role-gated create endpoint is NOT treated as a broken deploy — it proves authorization is working", async () => {
  writeContract([
    { method: "POST", path: "/api/v1/auth/register", auth: false },
    { method: "POST", path: "/api/v1/auth/login", auth: false },
    { method: "POST", path: "/api/v1/properties", auth: true },
  ]);
  const backendUrl = await startMockBackend(403, { success: false, error: "Forbidden: Landlord or Staff access required" });

  const result = await verifyLiveAuthenticatedRoundTrip(dir, backendUrl);

  expect(result.ok).toBe(true);
  expect(result.reason.toLowerCase()).toContain("403");
});

// 2026-08-17: real false-deploy-failure found live (fulfillio1) — getByIdEp
// used to be "the first GET-with-param endpoint anywhere in the contract",
// no correlation to createEp's own resource. A contract with a nested
// sub-resource (inventory items + a separate .../:id/locations endpoint,
// but no plain .../:id at all — added late via an escalated fix that never
// updated the locked contract) picked the sub-resource as getByIdEp: the
// create endpoint made an inventory ITEM, the read-back checked its
// (empty, unrelated) locations list for the marker, which was never going
// to be there. Verifies the mismatched sub-resource is never even called —
// the mock 404s it — and the check now correctly treats this as nothing to
// verify at this layer (ok: true), the same safe-skip already used when
// there's no createEp at all, rather than a wrong, doomed-to-fail match.
test("a GET-with-param endpoint for an unrelated sub-resource is not picked as the read-back check for a different created resource", async () => {
  writeContract([
    { method: "POST", path: "/api/v1/auth/register", auth: false },
    { method: "POST", path: "/api/v1/auth/login", auth: false },
    { method: "POST", path: "/api/v1/properties", auth: true },
    { method: "GET", path: "/api/v1/properties/:id/photos", auth: true },
  ]);
  // startMockBackend 404s anything but register/login/properties-POST — if
  // the fix regresses and picks /properties/:id/photos again, that request
  // hits the 404 branch and this test fails, proving the mismatch is gone.
  const backendUrl = await startMockBackend(201, { success: true, data: { id: "item-1" } });

  const result = await verifyLiveAuthenticatedRoundTrip(dir, backendUrl);

  expect(result.ok).toBe(true);
});

test("a genuine server failure (500) on the create endpoint IS still a real deploy failure", async () => {
  writeContract([
    { method: "POST", path: "/api/v1/auth/register", auth: false },
    { method: "POST", path: "/api/v1/auth/login", auth: false },
    { method: "POST", path: "/api/v1/properties", auth: true },
  ]);
  const backendUrl = await startMockBackend(500, { success: false, error: "Internal Server Error" });

  const result = await verifyLiveAuthenticatedRoundTrip(dir, backendUrl);

  expect(result.ok).toBe(false);
});

// ── buildPayloadForRequestType (pure) ───────────────────────────────────────
// 2026-08-03: real bug found live (project=verify4617991) — this check
// hardcoded a generic {title: marker} payload on every create call. A
// non-CRUD contact-form endpoint whose real requestType is
// `CreateContactRequest { subject: string; message: string; }` got 400
// "Required" on every attempt — a false "broken deploy" verdict on an app
// that genuinely worked (confirmed: the real frontend's own fetch call sends
// {subject, message} and succeeds). buildPayloadForRequestType derives the
// payload from the ACTUAL field list in shared-types.ts instead of guessing.
test("buildPayloadForRequestType derives real field names from a named interface", () => {
  const source = `export interface CreateContactRequest {\n  subject: string;\n  message: string;\n}\n`;
  const payload = buildPayloadForRequestType(source, "CreateContactRequest", "marker123");
  expect(payload).toEqual({ subject: "marker123", message: "marker123" });
});

test("buildPayloadForRequestType gives email-looking fields an email-shaped value", () => {
  const source = `export interface RegisterRequest {\n  name: string;\n  email: string;\n  password: string;\n}\n`;
  const payload = buildPayloadForRequestType(source, "RegisterRequest", "marker123");
  expect(payload!.name).toBe("marker123");
  expect(payload!.email).toContain("@");
  expect(payload!.password).toBe("marker123");
});

test("buildPayloadForRequestType returns null when the named type isn't found", () => {
  const source = `export interface SomethingElse {\n  x: string;\n}\n`;
  expect(buildPayloadForRequestType(source, "CreateContactRequest", "marker123")).toBeNull();
});

// 2026-08-09: real bug found live (project meridianbk4) — api-contract.json's
// requestType for POST /api/v1/appointments was NOT a named interface
// reference, it was the inline literal string
// "{ service_id: string; appointment_date: string }" written directly in the
// contract. The named-interface regex (interface <typeName> { ... }) can
// never match an inline literal — there's no "interface { ... } { ... }" to
// find in shared-types.ts — so this silently returned null, fell back to the
// generic {title: marker} payload, and every deploy verification failed with
// 400 "service_id: Required, appointment_date: Required" even though the
// real generated app (confirmed live: real register -> login -> book
// appointment with the correct field shape) worked correctly. Same failure
// class as the 2026-08-03 fix above — the verification tool guessing a
// payload shape instead of deriving the real one — just a second source
// format (inline literal, not named reference) that format wasn't taught to
// recognize yet.
test("buildPayloadForRequestType parses an inline object-literal requestType directly, without needing shared-types.ts", () => {
  const payload = buildPayloadForRequestType("", "{ service_id: string; appointment_date: string }", "marker123");
  expect(payload!.service_id).toBe("marker123");
  // appointment_date gets a real parseable ISO date, not the raw marker —
  // see fieldsToPayload's "date" heuristic, added alongside this fix.
  expect(isNaN(Date.parse(payload!.appointment_date as string))).toBe(false);
});

test("buildPayloadForRequestType gives an inline literal's email-looking field an email-shaped value", () => {
  const payload = buildPayloadForRequestType("", "{ email: string; note: string }", "marker123");
  expect(payload!.email).toContain("@");
  expect(payload!.note).toBe("marker123");
});

// 2026-08-10: real bug found live (freshtst1) — the date heuristic only
// matched field names containing the literal substring "date", so
// "start_time" (a genuinely common timestamp field name) fell through to
// the generic marker-string branch and got sent as-is, which the real
// generated backend correctly 400'd: "Valid start_time ISO date string is
// required". Broadened to also catch "*time*" and "*_at" field names —
// the other common REST/DB timestamp naming conventions (start_time,
// end_time, created_at, scheduled_at).
test("buildPayloadForRequestType gives 'time'/'_at'-named fields (not just literal 'date') a real ISO date value", () => {
  const payload = buildPayloadForRequestType("", "{ start_time: string; scheduled_at: string; runtime_minutes: number }", "marker123");
  // strict ISO-8601 shape (a real `.toISOString()` output) — NOT a loose
  // `isNaN(Date.parse(...))` check, which is a false-negative test:
  // Date.parse is lenient enough to accept plenty of non-ISO garbage.
  const isoShape = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  expect(payload!.start_time).toMatch(isoShape);
  expect(payload!.scheduled_at).toMatch(isoShape);
  expect(payload!.runtime_minutes).toBe(1); // numeric type still wins over the "time" substring
});

// 2026-08-10: real bug found live (freshtst1), follow-on to the fix above —
// a single fixed offset gave start_time and end_time the identical value,
// which a real backend correctly rejected: "start_time must be earlier than
// end_time".
test("buildPayloadForRequestType gives an 'end_time'-named field a strictly later value than a 'start_time'-named field", () => {
  const payload = buildPayloadForRequestType("", "{ start_time: string; end_time: string }", "marker123");
  const start = Date.parse(payload!.start_time as string);
  const end = Date.parse(payload!.end_time as string);
  expect(end).toBeGreaterThan(start);
});

// ── End-to-end: the round-trip check uses the derived payload, not {title} ──
function startMockBackendCapturingBody(createStatus: number): Promise<{ url: string; getLastBody: () => unknown }> {
  let lastBody: unknown = null;
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        if (req.url === "/api/v1/auth/register" && req.method === "POST") {
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } else if (req.url === "/api/v1/auth/login" && req.method === "POST") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ token: "fake-jwt-token" }));
        } else if (req.url === "/api/v1/contact" && req.method === "POST") {
          lastBody = raw ? JSON.parse(raw) : null;
          const sent = lastBody as Record<string, unknown>;
          res.writeHead(createStatus, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: "abc123", ...sent }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });
    server = srv;
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, getLastBody: () => lastBody });
    });
  });
}

test("verifyLiveAuthenticatedRoundTrip sends the real required fields (subject/message), not a hardcoded title", async () => {
  writeContract([
    { method: "POST", path: "/api/v1/auth/register", auth: false },
    { method: "POST", path: "/api/v1/auth/login", auth: false },
    { method: "POST", path: "/api/v1/contact", auth: true, requestType: "CreateContactRequest" },
  ]);
  writeFileSync(
    join(dir, "shared-types.ts"),
    `export interface CreateContactRequest {\n  subject: string;\n  message: string;\n}\n`,
  );
  const { url, getLastBody } = await startMockBackendCapturingBody(201);

  const result = await verifyLiveAuthenticatedRoundTrip(dir, url);

  expect(result.ok).toBe(true);
  const sentBody = getLastBody() as Record<string, unknown>;
  expect(sentBody.subject).toBeDefined();
  expect(sentBody.message).toBeDefined();
  expect(sentBody.title).toBeUndefined();
});

// 2026-08-03 (live, verify4617991): a create endpoint whose declared
// responseType is a minimal ack ({id, status} — no content fields at all)
// got a false "broken deploy" verdict because the echo check was a hard
// requirement. A real id is already sufficient evidence of a genuine write;
// the echo is now a bonus signal, not a blocker.
test("a minimal ack response ({id, status}, no echoed content) is NOT treated as a broken deploy", async () => {
  writeContract([
    { method: "POST", path: "/api/v1/auth/register", auth: false },
    { method: "POST", path: "/api/v1/auth/login", auth: false },
    { method: "POST", path: "/api/v1/contact", auth: true, requestType: "CreateContactRequest" },
  ]);
  writeFileSync(
    join(dir, "shared-types.ts"),
    `export interface CreateContactRequest {\n  subject: string;\n  message: string;\n}\n`,
  );
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url === "/api/v1/auth/register" && req.method === "POST") {
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } else if (req.url === "/api/v1/auth/login" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ token: "fake-jwt-token" }));
      } else if (req.url === "/api/v1/contact" && req.method === "POST") {
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "abc-123", status: "submitted" })); // no echoed content
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  const url = await new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });

  const result = await verifyLiveAuthenticatedRoundTrip(dir, url);

  expect(result.ok).toBe(true);
});

// 2026-08-09: real bug found live (project meridianbk4, direct follow-on to
// the inline-literal fix above) — once the payload actually included
// service_id/appointment_date (previously missing entirely), the create
// call still 400'd: "Invalid UUID format for service_id, appointment_date:
// Invalid appointment_date format". buildPayloadForRequestType's fallback
// for an unrecognized string field is the raw marker string
// ("nexsidi-e2e-verify-<timestamp>") — not a valid UUID and not a valid
// date. A real user's booking flow always sends a service_id fetched from a
// real GET /api/v1/services call first, and a real date they picked — this
// check needs to do the same instead of guessing a placeholder for a field
// that references another resource. resolveForeignKeyId looks up a real id
// from the matching GET list endpoint declared in the same api-contract.json
// (e.g. "service_id" -> GET /api/v1/services) and substitutes it into the
// payload before the create call, closing this specific false-negative
// class the same way the inline-literal fix closed the previous one.
test("verifyLiveAuthenticatedRoundTrip resolves a real service_id from GET /api/v1/services instead of sending a placeholder marker", async () => {
  writeContract([
    { method: "POST", path: "/api/v1/auth/register", auth: false },
    { method: "POST", path: "/api/v1/auth/login", auth: false },
    { method: "GET", path: "/api/v1/services", auth: false },
    { method: "POST", path: "/api/v1/appointments", auth: true, requestType: "{ service_id: string; appointment_date: string }" },
  ]);
  const REAL_SERVICE_ID = "11111111-2222-3333-4444-555555555555";
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url === "/api/v1/auth/register" && req.method === "POST") {
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } else if (req.url === "/api/v1/auth/login" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ token: "fake-jwt-token" }));
      } else if (req.url === "/api/v1/services" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        // 2026-08-09: double-nested envelope — matches the REAL shape
        // observed live ({"success":true,"data":{"services":[...]}}), which
        // the first version of this fix's unwrap logic (one level only)
        // missed entirely, leaving service_id on the placeholder marker.
        res.end(JSON.stringify({ success: true, data: { services: [{ id: REAL_SERVICE_ID, name: "Tune-up" }] } }));
      } else if (req.url === "/api/v1/appointments" && req.method === "POST") {
        const sent = raw ? JSON.parse(raw) : {};
        const dateOk = !isNaN(Date.parse(sent.appointment_date));
        if (sent.service_id === REAL_SERVICE_ID && dateOk) {
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: "appt-1", ...sent }));
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: "Invalid UUID format for service_id, appointment_date: Invalid appointment_date format" }));
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  const url = await new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });

  const svcResult = await verifyLiveAuthenticatedRoundTrip(dir, url);

  expect(svcResult.ok).toBe(true);
});

// 2026-08-10: real bug found live (freshtst1) — "class" ends in the letter
// "s" but is SINGULAR, not plural. The old naive pluralizer
// (`resource.endsWith("s") ? resource : resource+"s"`) treated it as
// already-plural and looked up "/api/v1/class", which doesn't exist —
// silently failing to resolve class_id and 400ing every downstream create.
// 2026-08-10: real bug found live (user request) — every path-parameter
// check in this file matched the literal "{id}" convention, but the REAL
// contract convention (RestEndpoint.path's own doc comment, and every
// actual generated api-contract.json) is Express-style ":id". This meant
// PATCH/PUT/DELETE verification silently NEVER RAN against any real
// project — updateEp/deleteEp were always undefined, so "0 findings" meant
// "the check never executed," not "verified clean." This test uses the
// REAL ":id" convention (not "{id}") specifically to catch this class of
// bug — every existing test in this file used "{id}", which is exactly why
// this went undetected all session.
test("verifyAllResourceCrud actually exercises PATCH and DELETE against a real ':id' path (not '{id}') — the real contract convention", async () => {
  writeContract([
    { method: "POST", path: "/api/v1/auth/register", auth: false },
    { method: "POST", path: "/api/v1/auth/login", auth: false },
    { method: "POST", path: "/api/v1/appointments", auth: true, requestType: "{ status: string }" },
    { method: "PATCH", path: "/api/v1/appointments/:id", auth: true, requestType: "{ status: string }" },
    { method: "DELETE", path: "/api/v1/appointments/:id", auth: true },
  ]);
  const { url } = await startFullCrudMockBackend();
  // getDbRow always returns the stale pre-update row — if PATCH's
  // verification actually ran, this MUST be reported as a finding. If the
  // ":id" path-param bug is present, updateEp is never found, the PATCH
  // block never runs, and this silently reports zero findings instead.
  const staleRow = { id: "appt-1", status: "scheduled" };
  const result = await verifyAllResourceCrud(dir, url, (table) => (table === "appointments" ? staleRow : null));

  expect(result.ok).toBe(false);
  expect(result.findings.some((f) => f.toLowerCase().includes("patch") && f.toLowerCase().includes("did not persist"))).toBe(true);
});

test("resolveForeignKeyId correctly pluralizes a singular resource that itself ends in 's' (class -> classes)", async () => {
  server = createServer((req, res) => {
    if (req.url === "/api/v1/classes" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: { classes: [{ id: "class-real-id" }] } }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  const url = await new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });

  const resolved = await resolveForeignKeyId(
    "class_id",
    [{ method: "GET", path: "/api/v1/classes", auth: false }],
    url,
    "irrelevant-token",
  );

  expect(resolved).toBe("class-real-id");
});

// ── verifyAllResourceCrud ────────────────────────────────────────────────────
// 2026-08-09: real gap found live (project meridianbk4) — Riya's live
// verification only ever checked ONE hardcoded resource (the first auth:true
// POST endpoint found). A form submission for any OTHER resource (the
// contact_messages table was the concrete instance: it genuinely persists,
// confirmed by hand, but nothing in the automated pipeline was checking that
// — it was found only because a human went looking) could silently go
// nowhere and nothing would catch it. verifyAllResourceCrud generalizes the
// proven register->login->create->db-check->list pattern into a loop over
// EVERY resource group in the contract, exercising update/delete too where
// declared, with a real per-step finding (not one pass/fail for the whole
// deploy) so a broken PATCH on one resource doesn't get conflated with a
// working POST on another.
//
// getDbRow is injectable specifically so the HTTP-flow/iteration logic here
// is unit-testable without a real Docker/Postgres instance — the REAL
// docker-exec-backed row lookup (the default when omitted) is verified live,
// matching this file's own established convention for every other
// Docker/psql-touching function (applyMigrationsToDeployedDb,
// verifyDbWriteReadRoundTrip — neither has a unit test either, for the same
// reason).
function startFullCrudMockBackend(): Promise<{ url: string; db: Map<string, Record<string, unknown>> }> {
  const db = new Map<string, Record<string, unknown>>(); // key: "table:id"
  let nextId = 1;
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = raw ? JSON.parse(raw) : {};
        if (req.url === "/api/v1/auth/register" && req.method === "POST") {
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } else if (req.url === "/api/v1/auth/login" && req.method === "POST") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ token: "fake-jwt-token" }));
        } else if (req.url === "/api/v1/services" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: { services: [{ id: "svc-1", name: "Tune-Up" }] } }));
        } else if (req.url === "/api/v1/appointments" && req.method === "POST") {
          const id = `appt-${nextId++}`;
          const row = { id, status: "scheduled", ...body };
          db.set(`appointments:${id}`, row);
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: row }));
        } else if (req.url === "/api/v1/appointments" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: { appointments: [...db.values()] } }));
        } else if (req.url?.match(/^\/api\/v1\/appointments\/[^/]+$/) && req.method === "GET") {
          const id = req.url.split("/").pop();
          const existing = id ? db.get(`appointments:${id}`) : undefined;
          if (!existing) { res.writeHead(404); res.end(); return; }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: existing }));
        } else if (req.url?.match(/^\/api\/v1\/appointments\/[^/]+$/) && req.method === "PATCH") {
          const id = req.url.split("/").pop();
          const existing = id ? db.get(`appointments:${id}`) : undefined;
          if (!existing || !id) { res.writeHead(404); res.end(); return; }
          const updated = { ...existing, ...body };
          db.set(`appointments:${id}`, updated);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: updated }));
        } else if (req.url?.match(/^\/api\/v1\/appointments\/[^/]+$/) && req.method === "DELETE") {
          const id = req.url.split("/").pop();
          if (id) db.delete(`appointments:${id}`);
          res.writeHead(204);
          res.end();
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, db });
    });
  });
}

test("verifyAllResourceCrud verifies create/read/update/delete for a resource with real DB checks, not just HTTP status", async () => {
  writeContract([
    { method: "POST", path: "/api/v1/auth/register", auth: false },
    { method: "POST", path: "/api/v1/auth/login", auth: false },
    { method: "GET", path: "/api/v1/services", auth: false },
    { method: "POST", path: "/api/v1/appointments", auth: true, requestType: "{ status: string }" },
    { method: "GET", path: "/api/v1/appointments", auth: true },
    { method: "PATCH", path: "/api/v1/appointments/{id}", auth: true, requestType: "{ status: string }" },
    { method: "DELETE", path: "/api/v1/appointments/{id}", auth: true },
  ]);
  const { url, db } = await startFullCrudMockBackend();

  const result = await verifyAllResourceCrud(dir, url, (table, id) => db.get(`${table}:${id}`) ?? null);

  expect(result.ok).toBe(true);
  expect(result.findings).toEqual([]);
});

// 2026-08-10: real gap found live (explicit user request) — a resource's
// create was verified via db_query and its presence in the LIST endpoint,
// but nothing independently confirmed a real user could actually FETCH the
// specific record back by id (GET /resource/:id) — the single most common
// real-world read path (a detail page, an edit form pre-fill). A backend
// whose list endpoint works but whose get-by-id route is missing, 404s, or
// returns the WRONG record would have passed silently. Only exercised when
// the contract actually declares a GET-by-id endpoint (some real apps only
// ever expose a list, in which case there's nothing to check here — matches
// this file's own established "don't invent a check for something the
// contract never claimed to have" convention).
test("verifyAllResourceCrud fetches the created record back by id (GET /resource/:id) and reports a finding if that specific route is broken", async () => {
  writeContract([
    { method: "POST", path: "/api/v1/auth/register", auth: false },
    { method: "POST", path: "/api/v1/auth/login", auth: false },
    { method: "POST", path: "/api/v1/appointments", auth: true, requestType: "{ status: string }" },
    { method: "GET", path: "/api/v1/appointments/:id", auth: true },
  ]);
  // GET-by-id deliberately broken: always 404s, even though the row exists
  // (confirmed via the SAME getDbRow the create/list checks already trust).
  const db = new Map<string, Record<string, unknown>>();
  let nextId = 1;
  const srv = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      if (req.url === "/api/v1/auth/register" && req.method === "POST") { res.writeHead(201); res.end(JSON.stringify({ success: true })); return; }
      if (req.url === "/api/v1/auth/login" && req.method === "POST") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ token: "t" })); return; }
      if (req.url === "/api/v1/appointments" && req.method === "POST") {
        const id = `appt-${nextId++}`;
        const row = { id, ...body };
        db.set(`appointments:${id}`, row);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: row }));
        return;
      }
      res.writeHead(404); res.end(); // GET /appointments/:id always 404s — the bug
    });
  });
  server = srv;
  const url = await new Promise<string>((resolve) => {
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });

  const result = await verifyAllResourceCrud(dir, url, (table, id) => db.get(`${table}:${id}`) ?? null);

  expect(result.ok).toBe(false);
  expect(result.findings.some((f) => f.includes("GET") && f.includes("appointments"))).toBe(true);
});

// 2026-08-19: real bug found live (project 6ec9787d5a81, RateGate) —
// getByIdEp used bare hasPathParam(e.path), which matched ANY GET with a
// path param, including a sub-resource endpoint one level deeper than the
// resource itself (here: GET /api/v1/projects/:projectId/metrics, a metrics
// aggregation route — not "fetch the project record by its own id", which
// this contract never declares at all). It wrongly treated the metrics
// response as if it should echo the project's own id, and flagged a false
// positive every time ("doesn't contain the created record's own id") even
// though the app has no bug — metrics endpoints aren't contracted to return
// the resource itself. getByIdEp must only match a path exactly one segment
// deeper than createEp's own path (the resource's real detail route), never
// a deeper nested sub-resource.
test("verifyAllResourceCrud does not mistake a nested sub-resource endpoint (GET /resource/:id/metrics) for the resource's own get-by-id route", async () => {
  writeContract([
    { method: "POST", path: "/api/v1/auth/register", auth: false },
    { method: "POST", path: "/api/v1/auth/login", auth: false },
    { method: "POST", path: "/api/v1/projects", auth: true, requestType: "{ name: string }" },
    // No genuine GET /api/v1/projects/:id — only a deeper sub-resource route.
    { method: "GET", path: "/api/v1/projects/:projectId/metrics", auth: true },
  ]);
  const db = new Map<string, Record<string, unknown>>();
  let nextId = 1;
  const srv = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      if (req.url === "/api/v1/auth/register" && req.method === "POST") { res.writeHead(201); res.end(JSON.stringify({ success: true })); return; }
      if (req.url === "/api/v1/auth/login" && req.method === "POST") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ token: "t" })); return; }
      if (req.url === "/api/v1/projects" && req.method === "POST") {
        const id = `proj-${nextId++}`;
        const row = { id, ...body };
        db.set(`projects:${id}`, row);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: row }));
        return;
      }
      if (req.url?.match(/^\/api\/v1\/projects\/[^/]+\/metrics$/) && req.method === "GET") {
        // Real shape: aggregated metrics only, deliberately no project id.
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: { metrics: [], current_bucket_fill: 0, overage_cost_usd: 0 } }));
        return;
      }
      res.writeHead(404); res.end();
    });
  });
  server = srv;
  const url = await new Promise<string>((resolve) => {
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });

  const result = await verifyAllResourceCrud(dir, url, (table, id) => db.get(`${table}:${id}`) ?? null);

  expect(result.ok).toBe(true);
  expect(result.findings.some((f) => f.includes("doesn't contain the created record's own id"))).toBe(false);
});

test("verifyAllResourceCrud reports a specific finding when a created row doesn't actually exist in the DB", async () => {
  writeContract([
    { method: "POST", path: "/api/v1/auth/register", auth: false },
    { method: "POST", path: "/api/v1/auth/login", auth: false },
    { method: "POST", path: "/api/v1/appointments", auth: true, requestType: "{ status: string }" },
  ]);
  const { url } = await startFullCrudMockBackend();

  // getDbRow always returns null — simulates a create that returns 201 but
  // never actually reaches the database (the exact false-positive class this
  // function exists to catch).
  const result = await verifyAllResourceCrud(dir, url, () => null);

  expect(result.ok).toBe(false);
  expect(result.findings.some((f) => f.includes("appointments") && f.toLowerCase().includes("did not persist"))).toBe(true);
});

test("verifyAllResourceCrud reports a specific finding when PATCH returns 200 but the DB row doesn't reflect the change", async () => {
  writeContract([
    { method: "POST", path: "/api/v1/auth/register", auth: false },
    { method: "POST", path: "/api/v1/auth/login", auth: false },
    { method: "POST", path: "/api/v1/appointments", auth: true, requestType: "{ status: string }" },
    { method: "PATCH", path: "/api/v1/appointments/{id}", auth: true, requestType: "{ status: string }" },
  ]);
  const { url } = await startFullCrudMockBackend();
  // getDbRow always returns the ORIGINAL scheduled status, never reflecting
  // the PATCH — simulates an update endpoint that 200s without persisting.
  const staleRow = { id: "appt-1", status: "scheduled" };

  const result = await verifyAllResourceCrud(dir, url, (table) => (table === "appointments" ? staleRow : null));

  expect(result.ok).toBe(false);
  expect(result.findings.some((f) => f.toLowerCase().includes("patch") && f.toLowerCase().includes("did not persist"))).toBe(true);
});

test("verifyAllResourceCrud reports a specific finding when DELETE returns success but the row is still in the DB", async () => {
  writeContract([
    { method: "POST", path: "/api/v1/auth/register", auth: false },
    { method: "POST", path: "/api/v1/auth/login", auth: false },
    { method: "POST", path: "/api/v1/appointments", auth: true, requestType: "{ status: string }" },
    { method: "DELETE", path: "/api/v1/appointments/{id}", auth: true },
  ]);
  const { url } = await startFullCrudMockBackend();
  // getDbRow always returns a row — simulates a DELETE that 204s without
  // actually removing the row.
  const stillThere = { id: "appt-1", status: "scheduled" };

  const result = await verifyAllResourceCrud(dir, url, (table) => (table === "appointments" ? stillThere : null));

  expect(result.ok).toBe(false);
  expect(result.findings.some((f) => f.toLowerCase().includes("delete") && f.toLowerCase().includes("still"))).toBe(true);
});

test("verifyAllResourceCrud has nothing to verify for a read-only resource (GET only, no create) — not a finding", async () => {
  writeContract([
    { method: "POST", path: "/api/v1/auth/register", auth: false },
    { method: "POST", path: "/api/v1/auth/login", auth: false },
    { method: "GET", path: "/api/v1/services", auth: false },
  ]);
  const { url } = await startFullCrudMockBackend();

  const result = await verifyAllResourceCrud(dir, url, () => null);

  expect(result.ok).toBe(true);
  expect(result.findings).toEqual([]);
});

// 2026-08-10: real gap found live (project freshtst1) — a genuine role-gated
// dependency hierarchy (admin creates classes -> sessions; customer books
// against them). The base test account is a plain customer, so `classes`
// POST 403'd and was silently skipped (matches verifyLiveAuthenticatedRoundTrip's
// correct "403 = working auth, not a bug" precedent) — but that starved
// `sessions` (needs class_id) and then `bookings` (needs session_id) of
// anything real to reference, so bookings genuinely 400'd with "session_id
// required". The app was correct the whole time; the verifier just never
// tried an elevated identity for the resources that needed one, and never
// created parents before children. Confirmed live via direct DB inspection
// (0 classes, 0 sessions) before this fix.
function startRoleGatedHierarchyMockBackend(): Promise<{ url: string; db: Map<string, Record<string, unknown>> }> {
  const db = new Map<string, Record<string, unknown>>(); // key: "table:id"
  const rolesByEmail = new Map<string, string>();
  let nextId = 1;
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = raw ? JSON.parse(raw) : {};
        const auth = req.headers.authorization ?? "";
        const isAdmin = auth.includes("admin");

        const respond = (status: number, payload: unknown) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(payload));
        };
        const listOf = (table: string) => [...db.entries()].filter(([k]) => k.startsWith(`${table}:`)).map(([, v]) => v);

        if (req.url === "/api/v1/auth/register" && req.method === "POST") {
          rolesByEmail.set(body.email, body.role === "admin" ? "admin" : "customer");
          return respond(201, { success: true });
        }
        if (req.url === "/api/v1/auth/login" && req.method === "POST") {
          const role = rolesByEmail.get(body.email) ?? "customer";
          return respond(200, { token: `fake-jwt-token-${role}` });
        }
        if (req.url === "/api/v1/classes" && req.method === "POST") {
          if (!isAdmin) return respond(403, { success: false, error: "admin only" });
          const id = `class-${nextId++}`;
          const row = { id, ...body };
          db.set(`classes:${id}`, row);
          return respond(201, { data: row });
        }
        if (req.url === "/api/v1/classes" && req.method === "GET") {
          return respond(200, { data: { classes: listOf("classes") } });
        }
        const classDeleteMatch = req.url?.match(/^\/api\/v1\/classes\/([^/]+)$/);
        if (classDeleteMatch && req.method === "DELETE") {
          db.delete(`classes:${classDeleteMatch[1]}`);
          return respond(204, {});
        }
        if (req.url === "/api/v1/sessions" && req.method === "POST") {
          if (!isAdmin) return respond(403, { success: false, error: "admin only" });
          if (!body.class_id || !db.has(`classes:${body.class_id}`)) {
            return respond(400, { success: false, error: "Valid class_id (UUID) is required" });
          }
          const id = `session-${nextId++}`;
          const row = { id, ...body };
          db.set(`sessions:${id}`, row);
          return respond(201, { data: row });
        }
        if (req.url === "/api/v1/sessions" && req.method === "GET") {
          return respond(200, { data: { sessions: listOf("sessions") } });
        }
        const sessionDeleteMatch = req.url?.match(/^\/api\/v1\/sessions\/([^/]+)$/);
        if (sessionDeleteMatch && req.method === "DELETE") {
          db.delete(`sessions:${sessionDeleteMatch[1]}`);
          return respond(204, {});
        }
        if (req.url === "/api/v1/bookings" && req.method === "POST") {
          if (!body.session_id || !db.has(`sessions:${body.session_id}`)) {
            return respond(400, { success: false, error: "Valid session_id (UUID) is required" });
          }
          const id = `booking-${nextId++}`;
          const row = { id, ...body };
          db.set(`bookings:${id}`, row);
          return respond(201, { data: row });
        }
        if (req.url === "/api/v1/bookings" && req.method === "GET") {
          return respond(200, { data: { bookings: listOf("bookings") } });
        }
        respond(404, {});
      });
    });
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, db });
    });
  });
}

test("verifyAllResourceCrud registers an elevated identity on 403 and seeds parent resources before dependent ones, instead of starving downstream FKs", async () => {
  writeContract([
    { method: "POST", path: "/api/v1/auth/register", auth: false },
    { method: "POST", path: "/api/v1/auth/login", auth: false },
    { method: "POST", path: "/api/v1/classes", auth: true, requestType: "{ name: string }" },
    { method: "GET", path: "/api/v1/classes", auth: true },
    { method: "POST", path: "/api/v1/sessions", auth: true, requestType: "{ class_id: string }" },
    { method: "GET", path: "/api/v1/sessions", auth: true },
    { method: "POST", path: "/api/v1/bookings", auth: true, requestType: "{ session_id: string }" },
    { method: "GET", path: "/api/v1/bookings", auth: true },
  ]);
  const { url, db } = await startRoleGatedHierarchyMockBackend();

  const result = await verifyAllResourceCrud(dir, url, (table, id) => db.get(`${table}:${id}`) ?? null);

  expect(result.findings).toEqual([]);
  expect(result.ok).toBe(true);
  expect([...db.keys()].some((k) => k.startsWith("classes:"))).toBe(true);
  expect([...db.keys()].some((k) => k.startsWith("sessions:"))).toBe(true);
  expect([...db.keys()].some((k) => k.startsWith("bookings:"))).toBe(true);
});

// 2026-08-10: real bug found live (freshtst1), root-caused via direct
// Postgres statement-level logging (not guessed) — 100% reproducible, not
// a race condition. When "classes" ALSO has a DELETE endpoint (as every
// real generated app does), verifyAllResourceCrud's own full CRUD-lifecycle
// check for classes (create -> list -> update -> DELETE) deletes the exact
// row "sessions" needs to reference two steps later in the SAME run —
// resolveForeignKeyId then finds an empty list and 400s, not because
// anything is broken but because this verifier deleted its own seed data.
// The test above never declared a DELETE endpoint for classes/sessions, so
// it could never have caught this — that's the gap this test closes.
test("verifyAllResourceCrud does not delete a resource's own seed row when a downstream resource still needs to reference it via FK", async () => {
  writeContract([
    { method: "POST", path: "/api/v1/auth/register", auth: false },
    { method: "POST", path: "/api/v1/auth/login", auth: false },
    { method: "POST", path: "/api/v1/classes", auth: true, requestType: "{ name: string }" },
    { method: "GET", path: "/api/v1/classes", auth: true },
    { method: "DELETE", path: "/api/v1/classes/:id", auth: true },
    { method: "POST", path: "/api/v1/sessions", auth: true, requestType: "{ class_id: string }" },
    { method: "GET", path: "/api/v1/sessions", auth: true },
    { method: "DELETE", path: "/api/v1/sessions/:id", auth: true },
    { method: "POST", path: "/api/v1/bookings", auth: true, requestType: "{ session_id: string }" },
    { method: "GET", path: "/api/v1/bookings", auth: true },
  ]);
  const { url, db } = await startRoleGatedHierarchyMockBackend();

  const result = await verifyAllResourceCrud(dir, url, (table, id) => db.get(`${table}:${id}`) ?? null);

  expect(result.findings).toEqual([]);
  expect(result.ok).toBe(true);
  // the real assertion: classes' and sessions' seed rows must SURVIVE
  // (their delete check was correctly skipped) so bookings' FK resolution
  // for session_id — and sessions' own FK resolution for class_id — had
  // something real to find.
  expect([...db.keys()].some((k) => k.startsWith("classes:"))).toBe(true);
  expect([...db.keys()].some((k) => k.startsWith("sessions:"))).toBe(true);
  expect([...db.keys()].some((k) => k.startsWith("bookings:"))).toBe(true);
});

// 2026-08-10: real bug found live (freshtst1, same redeploy that exercised
// the admin-fallback fix above) — the real generated backend's create
// response was nested one level DEEPER than the existing single-level
// unwrap handled: {"success":true,"data":{"class":{"id":...,"name":...}}} —
// Express's {success,data} envelope wrapping ANOTHER named-key object (the
// same double-envelope shape resolveForeignKeyId's findFirstArray already
// had to handle for LIST responses, but this is the single-object CREATE
// response case, never fixed). `created.id` was undefined (the id is at
// created.class.id), so a genuinely successful create was misreported as
// "response has no id".
test("verifyAllResourceCrud finds the id in a create response nested under a resource-named key (data.class.id, not just data.id)", async () => {
  writeContract([
    { method: "POST", path: "/api/v1/auth/register", auth: false },
    { method: "POST", path: "/api/v1/auth/login", auth: false },
    { method: "POST", path: "/api/v1/classes", auth: true, requestType: "{ name: string }" },
  ]);
  const db = new Map<string, Record<string, unknown>>();
  let nextId = 1;
  const srv = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      const respond = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url === "/api/v1/auth/register" && req.method === "POST") return respond(201, { success: true });
      if (req.url === "/api/v1/auth/login" && req.method === "POST") return respond(200, { token: "fake-jwt-token" });
      if (req.url === "/api/v1/classes" && req.method === "POST") {
        const id = `class-${nextId++}`;
        const row = { id, ...body };
        db.set(`classes:${id}`, row);
        return respond(201, { success: true, data: { class: row } }); // the real, deeper-than-expected shape
      }
      respond(404, {});
    });
  });
  server = srv;
  const url = await new Promise<string>((resolve) => {
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });

  const result = await verifyAllResourceCrud(dir, url, (table, id) => db.get(`${table}:${id}`) ?? null);

  expect(result.findings).toEqual([]);
  expect(result.ok).toBe(true);
});
