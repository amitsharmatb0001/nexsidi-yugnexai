import { test, expect } from "bun:test";
import { isTransientSpawnError, deployWithRetry } from "./clone-deploy.ts";

// ── isTransientSpawnError (pure) ──────────────────────────────────────────
test("isTransientSpawnError recognizes the real, twice-reproduced Windows spawn failure", () => {
  const real = new Error("SystemError: spawnSync C:\\WINDOWS\\system32\\cmd.exe ETIMEDOUT");
  expect(isTransientSpawnError(real)).toBe(true);
});

test("isTransientSpawnError does not treat a real build failure as transient — must not mask a genuine error", () => {
  const realBuildFailure = new Error("target frontend: failed to solve: process \"/bin/sh -c npm run build\" did not complete successfully: exit code: 1");
  expect(isTransientSpawnError(realBuildFailure)).toBe(false);
});

// ── deployWithRetry (fake exec, DI) ───────────────────────────────────────
test("deployWithRetry succeeds immediately when the first attempt works — no wasted retry", async () => {
  let calls = 0;
  const execFn = () => { calls++; return ""; };
  await deployWithRetry("compose.yml", { execFn, maxAttempts: 3 });
  expect(calls).toBe(1);
});

test("deployWithRetry retries once after a transient spawn error and succeeds on the second real attempt", async () => {
  let calls = 0;
  const execFn = () => {
    calls++;
    if (calls === 1) throw new Error("SystemError: spawnSync C:\\WINDOWS\\system32\\cmd.exe ETIMEDOUT");
    return "";
  };
  await deployWithRetry("compose.yml", { execFn, maxAttempts: 3 });
  expect(calls).toBe(2);
});

test("deployWithRetry does NOT retry a real build failure — masking it would hide a genuine bug behind a transient-looking success on an unrelated later attempt", async () => {
  let calls = 0;
  const execFn = () => {
    calls++;
    throw new Error("target frontend: failed to solve: process \"/bin/sh -c npm run build\" did not complete successfully: exit code: 1");
  };
  await expect(deployWithRetry("compose.yml", { execFn, maxAttempts: 3 })).rejects.toThrow(/npm run build/);
  expect(calls).toBe(1);
});

test("deployWithRetry gives up and throws the last error after exhausting real transient retries — never retries forever", async () => {
  let calls = 0;
  const execFn = () => {
    calls++;
    throw new Error("SystemError: spawnSync C:\\WINDOWS\\system32\\cmd.exe ETIMEDOUT");
  };
  await expect(deployWithRetry("compose.yml", { execFn, maxAttempts: 2 })).rejects.toThrow(/ETIMEDOUT/);
  expect(calls).toBe(2);
});

// 2026-10-18 (Leafkeeper run): a build's images were built, then "docker compose up" failed with Docker having no
// network addresses left, because stale networks from earlier projects were never removed.
const POOL_ERROR = 'Error response from daemon: all predefined address pools have been fully subnetted';

test("isNetworkPoolExhausted recognises Docker running out of network addresses, and nothing else", async () => {
  const { isNetworkPoolExhausted } = await import("./clone-deploy.ts");
  expect(isNetworkPoolExhausted(new Error(`failed to create network x_app-net: ${POOL_ERROR}`))).toBe(true);
  expect(isNetworkPoolExhausted(new Error("npm ERR! build failed"))).toBe(false);
});

test("deployWithRetry removes unused Docker networks once and retries when Docker has no network addresses left", async () => {
  const { deployWithRetry } = await import("./clone-deploy.ts");
  const calls: string[] = [];
  const execFn = (command: string) => {
    calls.push(command);
    if (command.includes("up -d --build") && calls.filter((c) => c.includes("up -d --build")).length === 1) throw new Error(POOL_ERROR);
    return "";
  };
  await deployWithRetry("E:/x/docker-compose.yml", { execFn });
  expect(calls.map((c) => (c.includes("network prune") ? "prune" : "up"))).toEqual(["up", "prune", "up"]);
  expect(calls[1]).toBe("docker network prune -f");
});

test("deployWithRetry does not prune or retry for a real build failure", async () => {
  const { deployWithRetry } = await import("./clone-deploy.ts");
  const calls: string[] = [];
  const execFn = (command: string) => {
    calls.push(command);
    throw new Error("npm ERR! next build failed");
  };
  await expect(deployWithRetry("E:/x/docker-compose.yml", { execFn })).rejects.toThrow("next build failed");
  expect(calls.length).toBe(1);
});

test("deployWithRetry gives up after one prune: if the network pool is still exhausted it throws, it does not loop", async () => {
  const { deployWithRetry } = await import("./clone-deploy.ts");
  const calls: string[] = [];
  const execFn = (command: string) => {
    calls.push(command);
    if (command.includes("up -d --build")) throw new Error(POOL_ERROR);
    return "";
  };
  await expect(deployWithRetry("E:/x/docker-compose.yml", { execFn })).rejects.toThrow("fully subnetted");
  expect(calls.filter((c) => c.includes("network prune")).length).toBe(1);
  expect(calls.filter((c) => c.includes("up -d --build")).length).toBe(2);
});
