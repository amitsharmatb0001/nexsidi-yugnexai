import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { truncateOutput, execRunCommand } from "./command.ts";

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
test("execRunCommand actually runs npm-family commands on this platform (not ENOENT)", () => {
  const sandboxDir = mkdtempSync(join(tmpdir(), "nexsidi-command-test-"));
  try {
    const result = execRunCommand(sandboxDir, { command: "npm --version" });
    expect(result.status).toBe("success");
    expect(result.summary).not.toContain("ENOENT");
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});
