import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execDockerCompose } from "./docker.ts";

// 2026-08-06: real bug found live (project d749afe43d9c) — execDockerCompose
// used spawnSync, which blocks Node's ENTIRE event loop for the full
// duration of the child process. A real "docker compose up --build" often
// runs past the calling activity's heartbeatTimeout ("3 minutes",
// project-build.ts's orchestratorAct), and while blocked, the activity's
// setInterval heartbeat literally cannot fire — Node never gets a turn on
// the event loop to run the timer callback. Temporal then times out and
// retries the activity, which re-verifies the context-chain handoff against
// a manifest attempt 1 has since modified mid-blocking-call — a guaranteed
// hash mismatch that rollbackAndEscalate treats as tampering and kills the
// whole workflow, while attempt 1's blocked spawnSync keeps running to
// completion as an orphaned process. Converted to async spawn so the event
// loop stays free.

test("execDockerCompose returns a Promise, not a synchronous result — the actual regression this fix closes", () => {
  const result = execDockerCompose(process.cwd(), { action: "ps" });
  expect(result).toBeInstanceOf(Promise);
});

test("execDockerCompose does not block the event loop — a timer scheduled before the call still fires while it's running", async () => {
  let timerFired = false;
  const timer = setTimeout(() => { timerFired = true; }, 10);

  // "ps" against a directory with no docker-compose.yml still round-trips
  // through the real docker CLI (fails fast, doesn't hang) — enough to prove
  // the call is non-blocking without needing a real compose stack running.
  const dir = mkdtempSync(join(tmpdir(), "nexsidi-docker-test-"));
  try {
    await execDockerCompose(dir, { action: "ps", timeout_ms: 15_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  expect(timerFired).toBe(true);
  clearTimeout(timer);
});

test("execDockerCompose reports a timeout as a distinct error, not a false 'succeeded'", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nexsidi-docker-test-"));
  try {
    // 1ms timeout — the real docker CLI cannot possibly answer that fast,
    // forcing the SIGKILL timeout path deterministically.
    const result = await execDockerCompose(dir, { action: "ps", timeout_ms: 1 });
    expect(result.status).toBe("error");
    expect(result.summary).toContain("timeout");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
