// P4 (live NexTech run, 2026-07-25): see sandbox-env.ts's header comment
// for the real bug this closes — a generated app silently inheriting
// NexSidi's own platform DATABASE_URL and polluting the shared platform DB.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { SANDBOX_BLOCKED_ENV_VARS, buildSandboxEnv } from "./sandbox-env.ts";

const SNAPSHOT: Record<string, string | undefined> = {};
const TEST_KEYS = ["DATABASE_URL", "NIM_API_KEY", "ANTHROPIC_API_KEY", "PORT", "PATH", "HOME", "SOME_HARMLESS_VAR"];

beforeEach(() => {
  for (const key of TEST_KEYS) SNAPSHOT[key] = process.env[key];
  process.env.DATABASE_URL = "postgresql://nexsidi:secret@localhost:5434/nexsidi";
  process.env.NIM_API_KEY = "nvapi-real-secret-value";
  process.env.ANTHROPIC_API_KEY = "sk-ant-real-secret-value";
  process.env.PORT = "8080";
  process.env.SOME_HARMLESS_VAR = "harmless";
});

afterEach(() => {
  for (const key of TEST_KEYS) {
    if (SNAPSHOT[key] === undefined) delete process.env[key];
    else process.env[key] = SNAPSHOT[key];
  }
});

test("buildSandboxEnv strips every blocked platform secret", () => {
  const env = buildSandboxEnv();
  expect(env.DATABASE_URL).toBeUndefined();
  expect(env.NIM_API_KEY).toBeUndefined();
  expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(env.PORT).toBeUndefined();
});

test("buildSandboxEnv preserves harmless env vars needed for tools to function (PATH, HOME, arbitrary vars)", () => {
  const env = buildSandboxEnv();
  expect(env.PATH ?? env.Path).toBeTruthy(); // Windows may report it as "Path"
  expect(env.SOME_HARMLESS_VAR).toBe("harmless");
});

test("buildSandboxEnv merges caller-provided extras on top of the scrubbed base", () => {
  const env = buildSandboxEnv({ FORCE_COLOR: "0" });
  expect(env.FORCE_COLOR).toBe("0");
  expect(env.DATABASE_URL).toBeUndefined();
});

test("every key in SANDBOX_BLOCKED_ENV_VARS is actually stripped, not just the ones this test happens to set", () => {
  for (const key of SANDBOX_BLOCKED_ENV_VARS) {
    process.env[key] = "should-never-survive";
  }
  const env = buildSandboxEnv();
  for (const key of SANDBOX_BLOCKED_ENV_VARS) {
    expect(env[key]).toBeUndefined();
    delete process.env[key];
  }
});
