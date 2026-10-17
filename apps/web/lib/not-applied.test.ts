import { test, expect } from "bun:test";
import { notAppliedOf } from "./not-applied.ts";

// 2026-10-18: parts of a request the build could not apply are shown to the person, not buried in a summary.
test("notAppliedOf returns the text of each part the build left out", () => {
  expect(notAppliedOf({ notApplied: ["editing — the app has no edit screen.", "dark mode — no theme switch."] })).toEqual([
    "editing — the app has no edit screen.",
    "dark mode — no theme switch.",
  ]);
});

test("notAppliedOf is empty for a missing, malformed or empty field, and drops non-text entries", () => {
  expect(notAppliedOf({})).toEqual([]);
  expect(notAppliedOf({ notApplied: "nope" })).toEqual([]);
  expect(notAppliedOf({ notApplied: [] })).toEqual([]);
  expect(notAppliedOf({ notApplied: ["a", 3, null, "  ", "b"] })).toEqual(["a", "b"]);
});
