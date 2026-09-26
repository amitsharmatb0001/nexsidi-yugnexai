import { test, expect } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execDockerCompose } from "./docker.ts";

// Stands in for child_process.spawn so "up" can be tested without starting
// real containers: records the args and the compose file as it was at the
// moment docker would have run, then exits 0.
function fakeSpawn(dir: string, record: { calls: string[][]; composeAtSpawn?: string }) {
  return ((_cmd: string, args: string[]) => {
    record.calls.push(args);
    record.composeAtSpawn = readFileSync(join(dir, "docker-compose.yml"), "utf-8");
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => child.emit("close", 0));
    return child;
  }) as unknown as NonNullable<Parameters<typeof execDockerCompose>[2]>["spawnFn"];
}

const PLAIN_COMPOSE = `services:\n  postgres:\n    image: postgres:16\n    ports:\n      - "5437:5432"\n  backend:\n    build: ./backend\n    ports:\n      - "3303:3001"\n  frontend:\n    build: ./frontend\n    ports:\n      - "3202:3000"\n`;

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

// 2026-09-26 security fix: generated apps published every port on 0.0.0.0,
// reachable from the whole Wi-Fi. "up" now binds published ports to
// 127.0.0.1 before docker runs, and refuses ports it cannot bind safely.

test("execDockerCompose up binds plain published ports to 127.0.0.1 before docker runs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nexsidi-docker-test-"));
  try {
    writeFileSync(join(dir, "docker-compose.yml"), PLAIN_COMPOSE);
    const record: { calls: string[][]; composeAtSpawn?: string } = { calls: [] };
    const result = await execDockerCompose(dir, { action: "up" }, { spawnFn: fakeSpawn(dir, record) });
    expect(result.status).toBe("success");
    expect(result.summary).toContain("bound 3 published port(s) to 127.0.0.1");
    expect(record.calls).toEqual([["compose", "up", "-d", "--build", "--remove-orphans"]]);
    expect(record.composeAtSpawn).toContain(`- "127.0.0.1:5437:5432"`);
    expect(record.composeAtSpawn).toContain(`- "127.0.0.1:3303:3001"`);
    expect(record.composeAtSpawn).toContain(`- "127.0.0.1:3202:3000"`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("execDockerCompose up refuses a port it cannot bind to 127.0.0.1 and never runs docker", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nexsidi-docker-test-"));
  try {
    writeFileSync(join(dir, "docker-compose.yml"), `services:\n  web:\n    image: nginx\n    ports:\n      - "3000"\n`);
    const record: { calls: string[][] } = { calls: [] };
    const result = await execDockerCompose(dir, { action: "up" }, { spawnFn: fakeSpawn(dir, record) });
    expect(result.status).toBe("error");
    expect(result.summary).toContain(`"127.0.0.1:<host>:<container>"`);
    expect(record.calls).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("execDockerCompose down is never blocked by the port guard — tearing down an exposed app must always work", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nexsidi-docker-test-"));
  try {
    writeFileSync(join(dir, "docker-compose.yml"), `services:\n  web:\n    image: nginx\n    ports:\n      - "3000"\n`);
    const record: { calls: string[][] } = { calls: [] };
    const result = await execDockerCompose(dir, { action: "down" }, { spawnFn: fakeSpawn(dir, record) });
    expect(result.status).toBe("success");
    expect(record.calls).toEqual([["compose", "down", "--remove-orphans"]]);
    expect(readFileSync(join(dir, "docker-compose.yml"), "utf-8")).toContain(`- "3000"`); // untouched
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
