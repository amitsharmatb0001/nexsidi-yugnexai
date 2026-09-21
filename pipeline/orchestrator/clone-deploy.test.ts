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
