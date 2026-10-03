import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { buildPayloadForRequestType, repairPayloadFromValidationError } from "./index.ts";

// 2026-10-03 (Ledgerly benchmark run 4): the deploy check created a test
// client with a GSTIN made of its long marker string; the app correctly
// answered "gstin: String must contain at most 15 character(s)", the deploy
// was marked failed twice, and the run stopped — on an app that worked.
// Test values now look like real ones, and a length error from the app's own
// validator is repaired and resent once, like the existing enum repair.

const TYPES = `
export interface CreateClientRequest {
  name: string;
  email: string;
  phone: string;
  billing_address: string;
  state: string;
  gstin?: string;
  pincode?: string;
  pan?: string;
  ifsc?: string;
  upi_id?: string;
  sac_code?: string;
  website?: string;
}`;

test("test values look like real Indian business data, not a long marker", () => {
  const p = buildPayloadForRequestType(TYPES, "CreateClientRequest", "nexsidi-e2e-verify-1791016012345")!;
  expect(String(p.gstin)).toMatch(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/);
  expect(String(p.phone)).toMatch(/^[6-9]\d{9}$/);
  expect(String(p.pincode)).toMatch(/^\d{6}$/);
  expect(String(p.pan)).toMatch(/^[A-Z]{5}\d{4}[A-Z]$/);
  expect(String(p.ifsc)).toMatch(/^[A-Z]{4}0[A-Z0-9]{6}$/);
  expect(String(p.upi_id)).toMatch(/^[\w.-]+@[\w]+$/);
  expect(String(p.sac_code)).toMatch(/^\d{4,6}$/);
  expect(String(p.website)).toMatch(/^https:\/\//);
  expect(p.state).toBe("Maharashtra");
  // the marker still identifies the test row
  expect(String(p.email)).toContain("nexsidi-e2e-verify-1791016012345");
  expect(String(p.name)).toContain("nexsidi-e2e-verify");
});

test("a 'too long' error from the app's validator is repaired to fit", () => {
  const payload = { name: "nexsidi-e2e-verify-1791016012345", gstin: "nexsidi-e2e-verify-1791016012345" };
  const r = repairPayloadFromValidationError(payload, '{"success":false,"error":"gstin: String must contain at most 15 character(s)"}')!;
  expect(String(r.gstin).length).toBeLessThanOrEqual(15);
  expect(r.name).toBe(payload.name);
});

test("a 'too short' error is repaired by lengthening the value", () => {
  const r = repairPayloadFromValidationError({ password: "abc" }, '{"error":"password: String must contain at least 12 character(s)"}')!;
  expect(String(r.password).length).toBeGreaterThanOrEqual(12);
});

test("several field errors in one message are all repaired", () => {
  const r = repairPayloadFromValidationError(
    { gstin: "x".repeat(40), phone: "1".repeat(30) },
    "gstin: String must contain at most 15 character(s), phone: String must contain at most 10 character(s)",
  )!;
  expect(String(r.gstin).length).toBeLessThanOrEqual(15);
  expect(String(r.phone).length).toBeLessThanOrEqual(10);
});

test("errors that are not about a value's shape still surface as real findings", () => {
  expect(repairPayloadFromValidationError({ name: "x" }, '{"error":"Internal Server Error"}')).toBeNull();
  expect(repairPayloadFromValidationError({ name: "x" }, '{"error":"email is required"}')).toBeNull();
});

test("the live round-trip check repairs a rejected test value once, like the full CRUD check", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  const start = src.indexOf("export async function verifyLiveAuthenticatedRoundTrip");
  const end = src.indexOf("\nexport ", start + 10);
  expect(src.slice(start, end)).toContain("repairPayloadFromValidationError(");
});
