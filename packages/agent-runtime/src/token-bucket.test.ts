// P5.W5.5 (full agentic upgrade plan — "remove the mechanical iteration-
// wasters"): real bug found live while testing config.maxIterations
// (max-iterations.test.ts) — FileLock.acquire()'s mkdirSync(lockPath) call
// assumes the lock directory's PARENT already exists. When it doesn't
// (ENOENT, not EEXIST — a brand-new BUILD_DIR nobody has created yet),
// mkdirSync throws every single attempt, the generic catch treats it
// identically to "another process holds the lock," and the retry loop never
// terminates: the 30-attempt "force clear a stale lock" rmdirSync also fails
// (there is nothing to remove — the parent itself is missing), and attempts
// keeps incrementing past 30 forever with no error surfaced. A caller whose
// BUILD_DIR doesn't pre-exist hangs forever with zero log output — exactly
// the kind of silent, undiagnosable hang this workstream exists to remove.
import { test, expect } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SharedTokenBucket } from "./token-bucket.ts";

test("SharedTokenBucket.acquire does not hang when BUILD_DIR's directory does not exist yet", async () => {
  const previousBuildDir = process.env.BUILD_DIR;
  const previousApiKey = process.env.NIM_API_KEY;
  // acquire() no-ops entirely when NIM_API_KEY is unset (test environments
  // mock the LLM client) — set it so this test actually exercises the real
  // FileLock path the bug lives in, not the early-return skip.
  process.env.NIM_API_KEY = "test-key-for-rate-limiter-path";
  // Deliberately nested, non-existent, never mkdirSync'd by this test —
  // this is the exact precondition that hung forever before the fix.
  const missingDir = join(tmpdir(), `nexsidi-filelock-test-${process.pid}`, "nested", "build-dir");
  process.env.BUILD_DIR = missingDir;

  try {
    const bucket = new SharedTokenBucket();
    await bucket.acquire(100);
    // Reaching here at all (within the test's timeout) is the assertion —
    // a hang manifests as a timeout failure, not a thrown error.
    expect(true).toBe(true);
  } finally {
    if (previousBuildDir === undefined) delete process.env.BUILD_DIR;
    else process.env.BUILD_DIR = previousBuildDir;
    if (previousApiKey === undefined) delete process.env.NIM_API_KEY;
    else process.env.NIM_API_KEY = previousApiKey;
    try {
      rmSync(join(tmpdir(), `nexsidi-filelock-test-${process.pid}`), { recursive: true, force: true });
    } catch {}
  }
}, 10_000);

// 2026-08-30: real, live, repeated (3x in one night) silent hang inside
// runAgent — "Starting — model: X" logged, then complete silence for 8-14+
// minutes: no error, no usage line, no escalation, nothing. Ruled out by
// direct live inspection that night: llm-client's own waitForToken (already
// capped earlier that same night), the fetch AbortController (240s, and
// covers body-reading too via a `finally`), a currently-stuck lock directory
// (checked live — not present), and real 40-RPM throttling (checked live —
// request count was 1, nowhere near the cap). FileLock.acquire() was the one
// remaining candidate with NO cap and NO log line of its own bracketing it —
// exactly matching the observed symptom shape. Root cause not conclusively
// proven (no debugger was attached to the actual hung process), but this
// closes the one candidate that had zero protection, using the identical
// "cap it, throw with real diagnostics" shape as this file's own prior fix
// above (P5.W5.5) and the earlier fix that same night to the OTHER,
// differently-located token bucket's identical unbounded wait.
import { FileLock } from "./token-bucket.ts";

test("FileLock.acquire throws instead of retrying forever when the lock can never be cleared", async () => {
  const dir = join(tmpdir(), `nexsidi-filelock-stuck-test-${process.pid}`);
  const { mkdirSync: realMkdirSync } = await import("node:fs");
  realMkdirSync(dir, { recursive: true });
  const lockPath = join(dir, "shared-token-bucket.lock");
  realMkdirSync(lockPath); // pre-create the lock — simulates one orphaned by a killed process

  try {
    const lock = new FileLock(dir, 300); // 300ms cap — fast to test, same mechanism as the real 60s default
    await expect(lock.acquire()).rejects.toThrow(/timed out after 300ms/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FileLock.acquire still succeeds immediately when the lock is genuinely free", async () => {
  const dir = join(tmpdir(), `nexsidi-filelock-free-test-${process.pid}`);
  try {
    const lock = new FileLock(dir, 300);
    await lock.acquire(); // must resolve, not throw or hang
    lock.release();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
