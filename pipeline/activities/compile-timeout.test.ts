import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

// 2026-10-22 (Trailhead Gear Rentals): the backend type check timed out at 60 seconds twice while three builders ran on
// the same machine ("tsc produced no output — ETIMEDOUT", then clean on rerun). Each timeout costs a full retry. The direct
// tsc call now gets the same three minutes as the install before it.
test("the direct tsc call has a three-minute time limit", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  const call = src.slice(src.indexOf("spawnSync(process.execPath, [localTscBin"), src.indexOf("spawnSync(process.execPath, [localTscBin") + 200);
  expect(call).toContain("timeout: 180_000");
});
