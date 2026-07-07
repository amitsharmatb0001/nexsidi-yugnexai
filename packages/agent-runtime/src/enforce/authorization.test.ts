import { test, expect } from "bun:test";
import { requireAuthorization, AuthorizationError } from "./authorization.ts";

// Phase 5 Task 7 (final-bundle/phase5-harness-enforcement-plan.md):
// authorization gate primitive, Wing-2 ready. Fail-loud blocking gate, same
// pattern as riya/src/index.ts's resolveDeployTarget("gcp") — called FIRST,
// before any work. Wing 1 uses it for the PRIVILEGED pending_human class;
// Wing 2's engagement gate (nexsidi-secwing-charter boundary #1 — "no
// authorization record = pipeline refuses to start") consumes it as-is.
// Pure function, zero infra — persistence of records is a later concern.

function futureIso(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 3_600_000).toISOString();
}

test("null record throws AuthorizationError", () => {
  expect(() => requireAuthorization(null, "wing1:pending_human")).toThrow(AuthorizationError);
});

test("null record's error identifies the missing-record field", () => {
  try {
    requireAuthorization(null, "wing1:pending_human");
    throw new Error("should have thrown");
  } catch (err) {
    expect(err).toBeInstanceOf(AuthorizationError);
    expect((err as AuthorizationError).field).toBe("record");
  }
});

test("an expired record throws AuthorizationError identifying expiresAt", () => {
  const record = { scope: "wing1:pending_human", authorizedBy: "amit", expiresAt: futureIso(-1) };
  try {
    requireAuthorization(record, "wing1:pending_human");
    throw new Error("should have thrown");
  } catch (err) {
    expect(err).toBeInstanceOf(AuthorizationError);
    expect((err as AuthorizationError).field).toBe("expiresAt");
  }
});

test("a scope mismatch throws AuthorizationError identifying scope", () => {
  const record = { scope: "wing1:pending_human", authorizedBy: "amit", expiresAt: futureIso(24) };
  try {
    requireAuthorization(record, "wing2:engagement:client-x");
    throw new Error("should have thrown");
  } catch (err) {
    expect(err).toBeInstanceOf(AuthorizationError);
    expect((err as AuthorizationError).field).toBe("scope");
  }
});

test("a valid, non-expired, in-scope record returns void without throwing", () => {
  const record = { scope: "wing1:pending_human", authorizedBy: "amit", expiresAt: futureIso(24) };
  expect(() => requireAuthorization(record, "wing1:pending_human")).not.toThrow();
  expect(requireAuthorization(record, "wing1:pending_human")).toBeUndefined();
});

test("AuthorizationError is a real Error subclass with a readable message", () => {
  try {
    requireAuthorization(null, "wing1:pending_human");
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message.length).toBeGreaterThan(0);
  }
});
