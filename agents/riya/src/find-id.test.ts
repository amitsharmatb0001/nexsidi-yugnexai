import { test, expect } from "bun:test";
import { findFirstObjectWithId } from "./index.ts";

// 2026-08-30: real live false positive (project 05b590e98102) — a "contact"
// create endpoint returned {success:true, inquiryId:"21ee39f1-a8fb-4d13-b054-
// 55d2bd85986c"}, a genuinely successful create with a real persisted row,
// but findFirstObjectWithId only matched the literal key "id" and reported
// "response has no id". That false positive repeated identically on Stage
// 6's retry (same response shape both times), tripping the stuck-detector
// and escalating a working deploy as deploy_stuck. See index.ts's own
// comment on this function for the full incident.

test("matches the literal 'id' key (unchanged original behavior)", () => {
  const found = findFirstObjectWithId({ id: "abc-123", name: "x" });
  expect(found?.id).toBe("abc-123");
});

test("matches a resource-specific camelCase id field and aliases it onto .id", () => {
  const body = { success: true, inquiryId: "21ee39f1-a8fb-4d13-b054-55d2bd85986c" };
  const found = findFirstObjectWithId(body);
  expect(found?.id).toBe("21ee39f1-a8fb-4d13-b054-55d2bd85986c");
  // original fields must survive the alias — callers may read more than .id
  expect(found?.inquiryId).toBe("21ee39f1-a8fb-4d13-b054-55d2bd85986c");
  expect(found?.success).toBe(true);
});

test("matches a snake_case id field", () => {
  const found = findFirstObjectWithId({ order_id: "ord-99", status: "pending" });
  expect(found?.id).toBe("ord-99");
});

test("matches the exact key 'uuid'", () => {
  const found = findFirstObjectWithId({ uuid: "u-1", label: "x" });
  expect(found?.id).toBe("u-1");
});

test("does NOT match a field that merely ends in the letters i,d lowercase", () => {
  // "valid" and "paid" both end in "id" as a raw substring — must not
  // false-match, or a boolean-shaped field would be mistaken for an id.
  const found = findFirstObjectWithId({ valid: "true", paid: "false" });
  expect(found).toBeUndefined();
});

test("prefers a literal 'id' over a resource-named field when both are present", () => {
  const found = findFirstObjectWithId({ id: "real-id", inquiryId: "should-not-be-used" });
  expect(found?.id).toBe("real-id");
});

test("still finds a nested literal 'id' one level down (pre-existing envelope-unwrap behavior)", () => {
  const found = findFirstObjectWithId({ success: true, data: { item: { id: "nested-1" } } });
  expect(found?.id).toBe("nested-1");
});

test("returns undefined for a response with no id-shaped field anywhere", () => {
  const found = findFirstObjectWithId({ success: true, message: "done" });
  expect(found).toBeUndefined();
});
