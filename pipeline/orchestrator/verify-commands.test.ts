import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyDir } from "./verify-commands.ts";

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function project(): string {
  dir = mkdtempSync(join(tmpdir(), "nexsidi-verify-"));
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  writeFileSync(join(dir, "package.json"), "{}");
  return dir;
}

const fakeSandbox = (result: { exitCode: number | null; stdout?: string; stderr?: string; timedOut?: boolean }, calls: any[]) =>
  async (spec: any) => {
    calls.push(spec);
    return { exitCode: result.exitCode, stdout: result.stdout ?? "", stderr: result.stderr ?? "", timedOut: result.timedOut ?? false, durationMs: 1, containerName: "x" };
  };

// Patent claim 5 / 1(e): generated code is executed in an isolated ephemeral container. Building it executes its build
// scripts, so the build commands can run inside the sandbox (switch: NEXSIDI_SANDBOX_BUILDS=on).
test("with the sandbox on, a build command runs in a locked-down container with the folder mounted, not on the host", async () => {
  const d = project();
  const calls: any[] = [];
  let shellCalled = false;
  const r = await verifyDir(d, [{ command: "npx tsc --noEmit", timeoutMs: 90_000 }], {
    sandbox: true,
    sandboxRun: fakeSandbox({ exitCode: 0 }, calls),
    shell: async () => { shellCalled = true; return { code: 0, output: "" }; },
  });
  expect(r).toEqual({ ran: true, ok: true, output: "" });
  expect(shellCalled).toBe(false);
  expect(calls.length).toBe(1);
  expect(calls[0].command).toEqual(["sh", "-c", "npx tsc --noEmit"]);
  expect(calls[0].network ?? "none").toBe("none");
  expect(calls[0].mounts[0].container).toBe("/work");
  expect(calls[0].mounts[0].readOnly).toBe(false);
  expect(calls[0].mounts[0].host).not.toContain("\\");
  expect(calls[0].limits.timeoutSec).toBe(90);
});

test("with the sandbox on, a failing command is reported with the tail of what it printed, and later commands do not run", async () => {
  const d = project();
  const calls: any[] = [];
  const r = await verifyDir(d, [{ command: "npx tsc --noEmit", timeoutMs: 1000 }, { command: "npm run build", timeoutMs: 1000 }], {
    sandbox: true,
    sandboxRun: fakeSandbox({ exitCode: 2, stdout: "error TS2322: bad", stderr: "" }, calls),
  });
  expect(r.ok).toBe(false);
  expect(r.ran).toBe(true);
  expect(r.output).toContain("TS2322");
  expect(calls.length).toBe(1);
});

test("with the sandbox on, a run that timed out is reported as one that could not finish", async () => {
  const d = project();
  const r = await verifyDir(d, [{ command: "npm run build", timeoutMs: 1000 }], { sandbox: true, sandboxRun: fakeSandbox({ exitCode: null, timedOut: true }, []) });
  expect(r.ok).toBe(false);
  expect(r.ran).toBe(false);
});

test("with the sandbox off, commands run on the host as before", async () => {
  const d = project();
  const calls: any[] = [];
  const r = await verifyDir(d, [{ command: "echo hi", timeoutMs: 1000 }], { sandbox: false, sandboxRun: fakeSandbox({ exitCode: 0 }, calls), shell: async () => ({ code: 0, output: "" }) });
  expect(r.ok).toBe(true);
  expect(calls.length).toBe(0);
});

test("a folder without installed dependencies is still skipped before anything runs", async () => {
  dir = mkdtempSync(join(tmpdir(), "nexsidi-verify-"));
  writeFileSync(join(dir, "package.json"), "{}");
  const r = await verifyDir(dir, [{ command: "x", timeoutMs: 10 }], { sandbox: true, sandboxRun: fakeSandbox({ exitCode: 0 }, []) });
  expect(r).toEqual({ ran: false, ok: false, output: "" });
});
