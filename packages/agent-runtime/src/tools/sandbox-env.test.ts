// P4 (live NexTech run, 2026-07-25): see sandbox-env.ts's header comment
// for the real bug this closes — a generated app silently inheriting
// NexSidi's own platform DATABASE_URL and polluting the shared platform DB.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { SANDBOX_BLOCKED_ENV_VARS, buildSandboxEnv, prependLocalBinToPath } from "./sandbox-env.ts";
import { join } from "node:path";

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

// 2026-08-29: real, severe bug found live (project 6c7d4358cf73). Shubham
// hit "three-strikes exhausted" running `tsc --noEmit` after the project's
// OWN code compiled with ZERO errors — confirmed directly by replicating
// command.ts's exact spawn call: `spawn("tsc.cmd", [...], { cwd, env })`
// threw ENOENT, "Executable not found in $PATH", because a bare spawn()
// NEVER adds `<cwd>/node_modules/.bin` to the search path the way npm/npx
// do internally. This affected every agent (Shubham/Aanya/Pranav/Riya/QA)
// on every project any time it ran a locally-installed dev-dependency binary
// without going through npm/npx — not something specific to this run. The
// model, seeing only silent failure with no compiler output to react to,
// burned 30+ iterations guessing at command-syntax variations before the
// strike-counter correctly gave up on a problem no prompt could ever fix.
test("prependLocalBinToPath makes the target directory's own node_modules/.bin resolvable", () => {
  const fakeSystemPath = join("nonexistent", "system32");
  const env = { PATH: fakeSystemPath };
  const cwd = join("nonexistent", "project");
  const expectedLocalBin = join(cwd, "node_modules", ".bin");
  const out = prependLocalBinToPath(env, cwd);
  expect(out.PATH!.startsWith(expectedLocalBin)).toBe(true);
  expect(out.PATH!).toContain(fakeSystemPath); // original PATH preserved, not replaced
});

test("prependLocalBinToPath finds PATH case-insensitively on Windows (env vars are case-insensitive there)", () => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "win32" });
  try {
    const cwd = join("nonexistent", "project");
    const env = { Path: join("nonexistent", "system32") }; // Windows sometimes reports it as "Path", not "PATH"
    const out = prependLocalBinToPath(env, cwd);
    expect(out.Path).toContain(join(cwd, "node_modules", ".bin"));
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  }
});

test("buildSandboxEnv prepends node_modules/.bin only when a cwd is given — docker.ts's call site is unaffected", () => {
  process.env.SOME_HARMLESS_VAR = "x";
  const cwd = join("nonexistent", "project");
  const withoutCwd = buildSandboxEnv({});
  const withCwd = buildSandboxEnv({}, cwd);
  expect(withCwd.PATH).toContain(join(cwd, "node_modules", ".bin"));
  expect(withoutCwd.PATH).toBe(process.env.PATH); // unchanged — same as before this fix existed
});

test("this is exactly the failure mode found live: spawn('tsc.cmd', ...) needs the LOCAL bin on PATH, not a global install", () => {
  // Source-shape guarantee: command.ts must actually pass its own cwd through,
  // not just have the capability defined and unused.
  const src = require("node:fs").readFileSync(new URL("./command.ts", import.meta.url), "utf-8");
  expect(src).toContain("buildSandboxEnv({ FORCE_COLOR: \"0\", NPM_CONFIG_FUND: \"false\", NPM_CONFIG_AUDIT: \"false\" }, cwd)");
});
