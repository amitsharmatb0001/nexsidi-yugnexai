import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { truncateOutput, execRunCommand, resolveCommandExecutable } from "./command.ts";

// Full-system audit TO1: execRunCommand used to keep the HEAD of long
// command output (stdout.slice(0, 6000)). Real build tool errors (npm
// install ERESOLVE conflicts, "Failed to compile" from next build) appear
// at the END of long output — agents were reading webpack progress noise
// and never seeing the actual failure, causing repeated blind re-runs of
// the same failing command (observed across stress-test runs 8/9/10).
// truncateOutput keeps a small head (command context) + a larger tail
// (where the real error almost always is), with a marker for the gap.

test("output shorter than the combined budget is returned unchanged", () => {
  const short = "line1\nline2\nline3";
  expect(truncateOutput(short, 100, 200)).toBe(short);
});

test("long output keeps the head and the tail, marks what was dropped", () => {
  const head = "a".repeat(50);
  const middle = "b".repeat(10_000);
  const tail = "ERROR: real failure message here";
  const long = head + middle + tail;

  const result = truncateOutput(long, 50, 100);

  expect(result.startsWith(head)).toBe(true);
  expect(result.endsWith(tail.slice(-100))).toBe(true);
  expect(result).toContain("truncated");
});

test("the real failure line at the tail survives truncation even with a huge middle", () => {
  const noisyBuild =
    "npm warn deprecated foo@1.0.0\n" +
    "info: installing dependencies...\n".repeat(2000) +
    "npm ERR! ERESOLVE unable to resolve dependency tree\n" +
    "npm ERR! Found: @types/react@19.0.0\n" +
    "npm ERR! Could not resolve dependency: @types/react@18.0.0";

  const result = truncateOutput(noisyBuild, 1000, 6000);

  expect(result).toContain("ERESOLVE unable to resolve dependency tree");
  expect(result).toContain("Could not resolve dependency");
});

// Real 2026-07-07 stress-test bug, root-caused via direct repro
// (spawnSync("npm", ["install"]) throws ENOENT in ~6ms without shell:true on
// Windows — Node's own docs: ".bat and .cmd files cannot be spawned
// directly... the shell option must be set to true"). Agents burned many
// iterations on workarounds (node -e "fs.unlinkSync(...)" instead of
// run_command('rm ...'), repeated failed npx/tsc attempts) because every
// npm/npx/tsc-family command failed instantly on Windows. This test exercises
// the REAL spawn path (no mocking) so a regression here fails loudly.
test("execRunCommand actually runs npm-family commands on this platform (not ENOENT)", async () => {
  const sandboxDir = mkdtempSync(join(tmpdir(), "nexsidi-command-test-"));
  try {
    const result = await execRunCommand(sandboxDir, { command: "npm --version" });
    expect(result.status).toBe("success");
    expect(result.summary).not.toContain("ENOENT");
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});

// 2026-08-06: real bug found live (project d749afe43d9c, root-cause traced
// in full in docker.ts — this is the identical bug class, fixed the same
// way). execRunCommand used spawnSync, which blocks Node's ENTIRE event
// loop for the child process's full duration — every agent's run_command
// tool call (npm install, tsc --noEmit, npm run build, all commonly taking
// well past a few seconds) risked starving the calling Temporal activity's
// heartbeat and triggering a false-positive context-chain violation that
// kills the whole workflow. Converted to async spawn; these tests prove the
// event loop stays free during a real command, not just that the function
// happens to return a Promise.
test("execRunCommand returns a Promise, not a synchronous result — the actual regression this fix closes", async () => {
  const sandboxDir = mkdtempSync(join(tmpdir(), "nexsidi-command-test-"));
  try {
    const result = execRunCommand(sandboxDir, { command: "npm --version" });
    expect(result).toBeInstanceOf(Promise);
    // Await before cleanup — the child process still holds the cwd handle
    // open on Windows until it exits; deleting the directory while it's
    // still running (unawaited) throws EBUSY.
    await result;
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});

test("execRunCommand does not block the event loop — a timer scheduled before the call still fires while it's running", async () => {
  let timerFired = false;
  const timer = setTimeout(() => { timerFired = true; }, 10);

  const sandboxDir = mkdtempSync(join(tmpdir(), "nexsidi-command-test-"));
  try {
    // "npm --version" is fast, but a real spawnSync call still blocks the
    // event loop for its full (short) duration — a 10ms timer scheduled
    // beforehand only fires during the call if the loop was genuinely free
    // to run it, not just because the command itself was quick.
    await execRunCommand(sandboxDir, { command: "npm --version" });
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }

  expect(timerFired).toBe(true);
  clearTimeout(timer);
});

test("execRunCommand reports a timeout as a distinct error, not a false 'succeeded'", async () => {
  const sandboxDir = mkdtempSync(join(tmpdir(), "nexsidi-command-test-"));
  try {
    // 1ms timeout — no real command can answer that fast, forcing the
    // SIGKILL timeout path deterministically.
    const result = await execRunCommand(sandboxDir, { command: "npm --version", timeout_ms: 1 });
    expect(result.status).toBe("error");
    expect(result.summary).toContain("timeout");
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});

test("uses Windows command shims without changing the recorded command", () => {
  expect(resolveCommandExecutable("npm", "win32")).toBe("npm.cmd");
  expect(resolveCommandExecutable("npx", "win32")).toBe("npx.cmd");
  expect(resolveCommandExecutable("npm", "linux")).toBe("npm");
});
