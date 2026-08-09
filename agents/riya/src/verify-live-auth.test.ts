import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { verifyLiveAuthenticatedRoundTrip, buildPayloadForRequestType, verifyAllResourceCrud } from "./index.ts";

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
