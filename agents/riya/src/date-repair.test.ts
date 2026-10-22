import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { repairPayloadFromValidationError } from "./index.ts";

// 2026-10-22 (Trailhead Gear Rentals): the app accepts only date-only values for a booking
// ("start_date and end_date must be valid dates in YYYY-MM-DD format"); the checks sent full timestamps, so no booking was
// ever created and the booking flow was never tested with data. The app names the format it wants; the check now resends
// in that format, with the end of a range a day after its start.
test("a YYYY-MM-DD error turns the timestamps sent into dates, end after start", () => {
  const sent = { start_date: "2026-11-10T08:00:00.000Z", end_date: "2026-11-10T09:00:00.000Z", note: "x", gear_id: "abc" };
  const fixed = repairPayloadFromValidationError(sent, '{"success":false,"error":"start_date and end_date must be valid dates in YYYY-MM-DD format"}');
  expect(fixed).not.toBeNull();
  expect(fixed!.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(fixed!.end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(String(fixed!.end_date) > String(fixed!.start_date)).toBe(true);
  expect(fixed!.note).toBe("x");
  expect(fixed!.gear_id).toBe("abc");
});

test("an error that does not name the date format is not treated as one", () => {
  const sent = { start_date: "2026-11-10T08:00:00.000Z" };
  expect(repairPayloadFromValidationError(sent, '{"error":"gear not found"}')).toBeNull();
});

test("a payload with no timestamps is left to the other repairs", () => {
  expect(repairPayloadFromValidationError({ name: "x" }, "must be YYYY-MM-DD")).toBeNull();
});

// Same build, next rejection: "At least one gear item must be selected". The contract writes the list inline,
// items: Array<{ gear_id: string; quantity: number }>, and the field reader cut it at the first ";" inside the braces.
test("an inline list of objects inside a request type is read whole", async () => {
  const { buildPayloadForRequestType } = await import("./index.ts");
  const p = buildPayloadForRequestType("", "{ start_date: string; end_date: string; waiver_signed: boolean; waiver_signature_name: string; items: Array<{ gear_id: string; quantity: number }> }", "m1");
  expect(p).not.toBeNull();
  expect(p!.waiver_signed).toBe(true);
  expect(Array.isArray(p!.items)).toBe(true);
  expect((p!.items as Array<Record<string, unknown>>)[0]).toEqual({ gear_id: expect.any(String), quantity: 1 });
});

test("ids nested inside lists are filled with real ids too", async () => {
  const { resolveNestedIds } = await import("./index.ts");
  const asked: string[] = [];
  const out = await resolveNestedIds({ user_id: "m", items: [{ gear_id: "m", quantity: 1 }], note: "x" }, async (field) => {
    asked.push(field);
    return field === "gear_id" ? "real-gear-1" : null;
  });
  expect(out).toEqual({ user_id: "m", items: [{ gear_id: "real-gear-1", quantity: 1 }], note: "x" });
  expect(asked.sort()).toEqual(["gear_id", "user_id"]);
});

test("the sample-data step also tries the repair once before giving up", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  const seed = src.slice(src.indexOf("export async function seedSampleData"), src.indexOf("export function compareSnapshots"));
  expect(seed).toContain("repairPayloadFromValidationError(");
});
