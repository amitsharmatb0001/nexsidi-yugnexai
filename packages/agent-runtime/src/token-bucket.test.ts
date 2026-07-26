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
