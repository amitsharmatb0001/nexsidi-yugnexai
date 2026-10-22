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

// 2026-10-22: the container sandbox (patent claim 5) was used only by the Express Build path; the full pipeline's type check
// ran generated code on the host every time. With the sandbox switched on it now runs in the container and leaves evidence.
test("the full pipeline's type check runs in the isolated container when the sandbox is on", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  const fn = src.slice(src.indexOf("export async function runCompileCheck"), src.indexOf("// ── WS event publisher"));
  expect(fn).toContain("sandboxDefault(process.env, process.platform)");
  expect(fn).toContain("{ sandbox: true }");
  expect(fn).toContain("recordClaimEvidence(buildDir, 5,");
  // the container branch comes before the host type check
  expect(fn.indexOf("{ sandbox: true }")).toBeLessThan(fn.indexOf("spawnSync(process.execPath, [localTscBin"));
});
