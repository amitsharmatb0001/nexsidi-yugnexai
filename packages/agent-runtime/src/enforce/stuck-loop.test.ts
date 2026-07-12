import { test, expect } from "bun:test";
import { detectStuckLoop } from "./stuck-loop.ts";

test("detectStuckLoop is false when fewer signatures than the threshold have accumulated", () => {
  expect(detectStuckLoop(["read_file:a", "read_file:a"], 3)).toBe(false);
});

test("detectStuckLoop is true when the last N signatures are all identical", () => {
  expect(detectStuckLoop(["list_files:{}", "read_file:a", "read_file:a", "read_file:a"], 3)).toBe(true);
});

test("detectStuckLoop is false when the last N signatures include any variation", () => {
  expect(detectStuckLoop(["read_file:a", "read_file:b", "read_file:a"], 3)).toBe(false);
});

test("detectStuckLoop only looks at the trailing window, not the whole history", () => {
  expect(detectStuckLoop(["read_file:a", "read_file:a", "read_file:a", "read_file:b", "read_file:c"], 3)).toBe(false);
});

test("detectStuckLoop respects a custom threshold", () => {
  expect(detectStuckLoop(["x", "x"], 2)).toBe(true);
  expect(detectStuckLoop(["x", "x"], 3)).toBe(false);
});
