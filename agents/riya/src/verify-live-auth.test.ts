import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { verifyLiveAuthenticatedRoundTrip, buildPayloadForRequestType } from "./index.ts";

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
