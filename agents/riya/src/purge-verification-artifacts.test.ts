import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { purgeVerificationArtifacts } from "./index.ts";

// 2026-08-27: real bug found live (project 852be5aeaef4). The live deploy
// verification steps register throwaway accounts —
// `verify+<role>+<ts>@example.com` — against the REAL deployed database, and
// nothing removed them. In that delivered app the ONLY row in `users` was one
// of these test accounts.
//
// The severe half is not the leftover row itself: verifyAllResourceCrud
// registers with role "admin" through the generated app's own one-time
// admin-bootstrap path ("role:'admin' allowed when no admin exists yet"), so
// verification CONSUMES the single bootstrap slot and the real owner can
// never claim admin. The deploy check silently locked the customer out of
// their own admin portal.

test("purgeVerificationArtifacts is a safe no-op when there is no docker-compose.yml", () => {
  const dir = mkdtempSync(join(tmpdir(), "riya-purge-"));
  try {
    // Must not throw — cleanup is best-effort and must never fail a deploy
    // that otherwise succeeded.
    expect(() => purgeVerificationArtifacts(dir)).not.toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("purgeVerificationArtifacts never throws on an unreachable/absent container", () => {
  const dir = mkdtempSync(join(tmpdir(), "riya-purge-"));
  try {
    // A compose file that names no running project — `docker compose ps -q`
    // yields nothing, which must be handled as "nothing to clean", not an error.
    require("node:fs").writeFileSync(join(dir, "docker-compose.yml"), "services: {}\n", "utf-8");
    expect(() => purgeVerificationArtifacts(dir)).not.toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Source-shape guarantees: the DELETE must be scoped to the exact address
// shape this file generates (a real user could never hold it), and cleanup
// must run after verification regardless of pass/fail — a FAILED run still
// registered accounts before it failed.
test("cleanup targets only the verify+...@example.com shape it created", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  expect(src).toContain("verify+%@example.com");
  // Discovers identity tables by column rather than assuming "users".
  expect(src).toContain("column_name='email'");
});

test("cleanup is invoked unconditionally after CRUD verification, not only on success", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  const callIdx = src.indexOf("purgeVerificationArtifacts(buildDir)");
  expect(callIdx).toBeGreaterThan(-1);
  // It must not sit inside the `if (!crudCheck.ok)` / `else` branches — the
  // 400 chars before the call should contain the end of that block, not an
  // open conditional guarding the call itself.
  const preceding = src.slice(Math.max(0, callIdx - 500), callIdx);
  expect(preceding).toContain("full CRUD verification OK");
});
