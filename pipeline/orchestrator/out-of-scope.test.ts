import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dropOutOfScopeFindings } from "./out-of-scope.ts";

// 2026-10-22 (Trailhead rerun): the live reviewer repeatedly asked for features nobody requested — booking cancellation
// (POST/DELETE /api/v1/bookings/:id/cancel) and GET /api/v1/auth/me. Each went to a builder, was disputed and settled "not
// true", but only after costing a round. A finding that says an endpoint is missing is now dropped before routing when
// the endpoint is not in the approved API contract AND no frontend code calls it. If the frontend does call it, it is a
// real broken call and stays.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "scope-"));
  writeFileSync(join(dir, "api-contract.json"), JSON.stringify({ endpoints: [
    { method: "GET", path: "/api/v1/gear" },
    { method: "GET", path: "/api/v1/gear/:id" },
    { method: "POST", path: "/api/v1/bookings" },
    { method: "GET", path: "/api/v1/bookings" },
  ] }));
  mkdirSync(join(dir, "frontend", "lib"), { recursive: true });
  writeFileSync(join(dir, "frontend", "lib", "api.ts"), "export const get = (id: string) => fetch(`/api/v1/gear/${id}`); export const avail = () => fetch('/api/v1/gear/availability');\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const f = (issue: string) => ({ file: "(site-wide)", issue });

test("a missing endpoint that the contract does not have and the frontend does not call is out of scope", () => {
  const cancel = f("Inability to Cancel Bookings: the backend does not expose any endpoint (e.g. POST /api/v1/bookings/:id/cancel or DELETE /api/v1/bookings/:id) to cancel a booking");
  const me = f("Missing GET /api/v1/auth/me Endpoint on Backend: requesting it returns 404");
  const r = dropOutOfScopeFindings([cancel, me], dir);
  expect(r.kept).toEqual([]);
  expect(r.dropped.map((d) => d.finding)).toEqual([cancel, me]);
});

// The real findings named approved endpoints as context ("only implements GET and POST /api/v1/bookings", "a token from
// POST /api/v1/auth/sign-in"), combined methods ("POST/DELETE") and full URLs ("http://localhost:3301/api/..."); the first
// version kept all three. Text taken from the real disputes file of the rerun.
test("real findings that ask for unrequested endpoints are dropped, whatever context they mention", () => {
  const real = [
    f("Missing Booking Cancellation: backend/src/routes/bookings.ts only implements `GET /api/v1/bookings` and `POST /api/v1/bookings` with no route to cancel. The backend API contract does not expose any endpoint (e.g. POST/DELETE /api/v1/bookings/:id/cancel) for cancelling."),
    f("Inability to Cancel, Edit, or Manage Existing Bookings (CONFIRMED via DELETE/PATCH http://localhost:3301/api/v1/bookings/:id): the page only performs a read-only GET '/api/v1/bookings'."),
    f("Missing GET /api/v1/auth/me Endpoint on Backend (CONFIRMED via GET http://localhost:3301/api/v1/auth/me): returns 404 with a valid Bearer token from 'POST /api/v1/auth/sign-in'."),
  ];
  expect(dropOutOfScopeFindings(real, dir).kept).toEqual([]);
});

test("a missing endpoint the frontend calls is a real broken call and stays", () => {
  const broken = f("Missing GET /api/v1/gear/availability endpoint on the backend: the catalog page requests it and gets 404");
  expect(dropOutOfScopeFindings([broken], dir).kept).toEqual([broken]);
});

test("a finding about an endpoint in the contract stays, as does any finding that is not about a missing endpoint", () => {
  const contract = f("POST /api/v1/bookings is missing validation of the end date");
  const bug = f("Prices render 100x too small on the catalog page");
  const inContract = f("GET /api/v1/gear/:id is missing on the backend");
  expect(dropOutOfScopeFindings([contract, bug, inContract], dir).kept).toEqual([contract, bug, inContract]);
});

test("without an API contract nothing is dropped", () => {
  rmSync(join(dir, "api-contract.json"));
  const me = f("Missing GET /api/v1/auth/me Endpoint on Backend");
  expect(dropOutOfScopeFindings([me], dir).kept).toEqual([me]);
});

test("the live retest drops out-of-scope findings before they are routed", () => {
  const src = readFileSync(new URL("./stages/stage6-deployment.ts", import.meta.url), "utf-8");
  const fn = src.slice(src.indexOf("export function guardLiveRetest"), src.indexOf("export interface LiveRetestResult"));
  expect(fn).toContain("dropOutOfScopeFindings(");
});
