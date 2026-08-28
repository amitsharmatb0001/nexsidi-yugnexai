import { test, expect } from "bun:test";
import { repairPayloadFromValidationError } from "./index.ts";

// 2026-08-27: this is the exact failure that ended project 852be5aeaef4.
// The api-contract typed the contact form's `type` as plain `string`, so the
// synthetic CRUD payload sent a marker. Shubham's backend validated it as
// z.enum(["support","sales"]) — a constraint present in NO shared artifact
// (not the spec, not the DB schema, not the contract). The backend correctly
// rejected the marker; the test was wrong. That false finding failed the
// deploy, triggered a retry, and the retry exhausted the cost budget.
const ZOD_ENUM_ERROR =
  '{"success":false,"error":"Invalid enum value. Expected \'support\' | \'sales\', received \'nexsidi-crud-verify-1787777268381\'"}';

test("recovers from a backend enum constraint the contract never declared", () => {
  const payload = { name: "T", email: "t@example.com", message: "hi", type: "nexsidi-crud-verify-1787777268381" };
  const repaired = repairPayloadFromValidationError(payload, ZOD_ENUM_ERROR);
  expect(repaired).not.toBeNull();
  expect(repaired!.type).toBe("support");
  // Every other field is preserved untouched — this repairs one value, it
  // does not rebuild the payload.
  expect(repaired!.email).toBe("t@example.com");
  expect(repaired!.message).toBe("hi");
});

test("returns null for a genuine 400 so real bugs still surface as findings", () => {
  const payload = { name: "T", message: "hi" };
  expect(repairPayloadFromValidationError(payload, '{"error":"email is required"}')).toBeNull();
  expect(repairPayloadFromValidationError(payload, "Internal Server Error")).toBeNull();
});

test("returns null when no sent field matches the rejected value — never guesses blindly", () => {
  const payload = { name: "T", type: "support" };
  // Validator complains about a value we never sent; repairing would be a guess.
  const err = "Invalid enum value. Expected 'a' | 'b', received 'something-we-did-not-send'";
  expect(repairPayloadFromValidationError(payload, err)).toBeNull();
});

test("handles a two-value enum without a received echo by finding the out-of-range field", () => {
  const payload = { status: "marker-value", name: "T" };
  const repaired = repairPayloadFromValidationError(payload, "Expected 'unread' | 'read'");
  expect(repaired!.status).toBe("unread");
});
