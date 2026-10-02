import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvidenceLedger } from "./evidence.ts";
import { checkCompletion } from "./completion-gate.ts";
import { runMissingRequiredChecks } from "./auto-checks.ts";

// 2026-10-02 (Ledgerly benchmark run 3): the frontend builder finished its
// work and called task_complete at step 90 of 90 without having run
// `npx tsc --noEmit` and the `cat app/...` file checks. The gate rejected it
// and the working frontend was thrown away — run afterwards, every one of
// those checks passed. The checks are mechanical, so the system runs any
// the agent skipped before judging the claim.

test("required checks the agent skipped are run, recorded, and the claim then passes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "auto-checks-"));
  try {
    writeFileSync(join(dir, "ok.txt"), "present");
    const ledger = createEvidenceLedger();
    ledger.record("file_read", "something");
    const required = ["cat ok.txt"];
    const claim = { summary: "done", filesWritten: [], verificationPassed: true };
    expect(checkCompletion(ledger, claim, required).allowed).toBe(false);

    const failures = await runMissingRequiredChecks(dir, ledger, required);
    expect(failures).toEqual([]);
    expect(checkCompletion(ledger, claim, required).allowed).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a skipped check that fails is reported with its output, so the agent can fix it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "auto-checks-"));
  try {
    const ledger = createEvidenceLedger();
    const failures = await runMissingRequiredChecks(dir, ledger, ["cat app/not-found.tsx"]);
    expect(failures.length).toBe(1);
    expect(failures[0]).toContain("cat app/not-found.tsx");
    expect(ledger.hasSuccessfulCommand("cat app/not-found.tsx")).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checks the agent already passed are not run again", async () => {
  const ledger = createEvidenceLedger();
  ledger.record("command_output", "cat nowhere/at/all.txt -> exited 0");
  // would fail if it ran — the directory does not exist
  expect(await runMissingRequiredChecks("Z:/does/not/exist", ledger, ["cat nowhere/at/all.txt"])).toEqual([]);
});

test("every agent loop runs the skipped required checks before judging task_complete", () => {
  for (const file of ["../loop.ts", "../gemini-loop.ts", "../claude-loop.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf-8");
    const run = source.indexOf("runMissingRequiredChecks(");
    const judge = source.indexOf("checkCompletion(");
    expect({ file, wired: run > 0 && run < judge }).toEqual({ file, wired: true });
  }
});
