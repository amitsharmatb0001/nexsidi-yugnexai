// NexSidi Temporal Worker
// Runs all pipeline activities and hosts the projectBuildWorkflow.
// Start with: bun pipeline/worker.ts
//
// For local dev: Temporal server must be running (docker-compose.dev.yml)
// Temporal UI: http://localhost:8088

import { Worker, NativeConnection } from "@temporalio/worker";
import { Connection } from "@temporalio/client";
import { fileURLToPath } from "url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { execSync } from "child_process";
import * as activities from "./activities/index.ts";

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TASK_QUEUE       = process.env.TEMPORAL_TASK_QUEUE ?? "nexsidi-pipeline";

// 2026-07-25 (Phase 7.1/7.2, full MVP upgrade): single-worker guard. This is
// the THIRD time a stale worker has invalidated a run (nextech1's Arjun race,
// then nextech6-9 all served by a worker started before maxIterations:60 was
// saved — Bun does not hot-reload TypeScript, so a worker only ever runs the
// code it loaded at startup). A one-time manual kill fixes one incident; this
// guard prevents the class of bug by refusing to start a second worker on the
// same task queue and printing exactly which PID to kill instead of silently
// letting two workers race for the same work.
const LOCK_PATH = join(process.cwd(), ".nexsidi", "worker.lock");

interface WorkerLock {
  pid: number;
  taskQueue: string;
  startedAt: string;
  gitHead: string;
}

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 sends nothing — it only checks whether the process exists and
    // is signalable. Works cross-platform under Node/Bun (Windows included).
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolveGitHead(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function acquireWorkerLock(): void {
  mkdirSync(dirname(LOCK_PATH), { recursive: true });

  if (existsSync(LOCK_PATH)) {
    try {
      const existing = JSON.parse(readFileSync(LOCK_PATH, "utf-8")) as WorkerLock;
      if (existing.taskQueue === TASK_QUEUE && isProcessAlive(existing.pid)) {
        console.error(
          `[worker] REFUSING TO START: another worker (PID ${existing.pid}) is already polling task queue "${TASK_QUEUE}", started ${existing.startedAt} at git ${existing.gitHead}.\n` +
          `A stale worker running old code has broken 3 prior runs (nextech1, nextech6-9) — Bun does not hot-reload TypeScript, so a worker only ever runs the code present when it started.\n` +
          `Kill it first: taskkill /PID ${existing.pid} /F   (Windows)  or  kill ${existing.pid}   (POSIX)\n` +
          `Then re-run this worker.`,
        );
        process.exit(1);
      }
      console.log(`[worker] found a stale lock (PID ${existing.pid} is not running) — replacing it`);
    } catch (e) {
      console.log(`[worker] found an unreadable lock file — replacing it: ${String(e)}`);
    }
  }

  const lock: WorkerLock = {
    pid: process.pid,
    taskQueue: TASK_QUEUE,
    startedAt: new Date().toISOString(),
    gitHead: resolveGitHead(),
  };
  writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2), "utf-8");
  console.log(`[worker] acquired lock: PID ${lock.pid}, git ${lock.gitHead}, task queue "${TASK_QUEUE}"`);
}

async function run(): Promise<void> {
  acquireWorkerLock();

  // 2026-07-25 (Phase 3.1): seedInstincts() existed but was called by
  // NOTHING except its own CLI block — the instincts table had 0 rows after
  // 9+ real pipeline runs (audit-2026-07-25.md, A.2). Idempotent by design
  // (skips triggers already present), so safe to call on every worker start.
  // Fail-open: a DB hiccup at startup must not prevent the worker from
  // running — instinct memory is an enrichment, not a hard dependency.
  try {
    const { seedInstincts } = await import("@nexsidi/db");
    const result = await seedInstincts();
    console.log(`[worker] instinct memory: seeded ${result.inserted} new, ${result.skipped} already present`);
  } catch (e) {
    console.error(`[worker] instinct seeding failed (continuing without it): ${String(e)}`);
  }

  console.log(`[worker] connecting to Temporal at ${TEMPORAL_ADDRESS}`);

  const connection = await NativeConnection.connect({ address: TEMPORAL_ADDRESS });

  const worker = await Worker.create({
    connection,
    namespace:     "default",
    taskQueue:     TASK_QUEUE,
    workflowsPath: fileURLToPath(new URL("./workflows/project-build.ts", import.meta.url)),
    activities,
    // Tune for long-running LLM calls:
    //   maxConcurrentActivityTaskExecutions: how many activities run in parallel
    //   Adjust based on NIM rate limits (3 parallel × 40 RPM = 120 RPM across 3 models)
    maxConcurrentActivityTaskExecutions: 6,
  });

  console.log(`[worker] running on task queue "${TASK_QUEUE}"`);

  // 2026-07-25 (Phase 7.2): release the lock on a clean shutdown so a
  // deliberate restart doesn't need the stale-lock fallback path. A crash
  // (no SIGTERM/SIGINT) leaves the lock in place — acquireWorkerLock's
  // isProcessAlive check on the next start correctly identifies it as stale
  // and replaces it, so this is a courtesy for the clean-exit path, not a
  // correctness requirement.
  const releaseLock = () => {
    try {
      if (existsSync(LOCK_PATH)) {
        const current = JSON.parse(readFileSync(LOCK_PATH, "utf-8")) as WorkerLock;
        if (current.pid === process.pid) writeFileSync(LOCK_PATH, "", "utf-8");
      }
    } catch {
      // best-effort — a failed cleanup here must not block shutdown
    }
  };

  process.on("SIGTERM", () => {
    console.log("[worker] SIGTERM received — shutting down gracefully");
    releaseLock();
    worker.shutdown();
  });
  process.on("SIGINT", () => {
    console.log("[worker] SIGINT received — shutting down gracefully");
    releaseLock();
    worker.shutdown();
  });

  await worker.run();
}

run().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
