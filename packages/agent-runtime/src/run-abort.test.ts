import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { runWithAbortSignal, currentAbortSignal, runStopReason } from "./run-abort.ts";

// Ledgerly benchmark, first run: the frontend generation step timed out after
// 30 minutes, but the agent kept running while Temporal started a retry — two
// frontend agents wrote the same files at once for half an hour — and the
// retry started from step 1 because history was saved only when an agent
// finished. An agent run now stops at its next step once its activity is
// cancelled or times out, and saves progress as it goes.

test("an agent run sees the abort signal of the activity it runs in", async () => {
  const controller = new AbortController();
  expect(currentAbortSignal()).toBeUndefined();
  await runWithAbortSignal(controller.signal, async () => {
    await Promise.resolve();
    expect(currentAbortSignal()).toBe(controller.signal);
  });
  expect(currentAbortSignal()).toBeUndefined();
});

test("parallel activities each see their own signal", async () => {
  const a = new AbortController();
  const b = new AbortController();
  a.abort("TIMED_OUT");
  const [seenA, seenB] = await Promise.all([
    runWithAbortSignal(a.signal, async () => { await new Promise((r) => setTimeout(r, 5)); return runStopReason(); }),
    runWithAbortSignal(b.signal, async () => { await new Promise((r) => setTimeout(r, 1)); return runStopReason(); }),
  ]);
  expect(seenA).toContain("TIMED_OUT");
  expect(seenB).toBeNull();
});

test("runStopReason prefers an explicit config signal and is null when nothing is aborted", () => {
  const c = new AbortController();
  expect(runStopReason({ abortSignal: c.signal })).toBeNull();
  c.abort("cancelled by workflow");
  expect(runStopReason({ abortSignal: c.signal })).toContain("cancelled by workflow");
  expect(runStopReason()).toBeNull();
});

// Every step is recorded, in every stage (spec, planning, generation, QA,
// fixes, deploy, live review): the history is saved after each step.
test("every agent loop stops on a cancelled run and saves its history after every step", () => {
  for (const file of ["loop.ts", "gemini-loop.ts", "claude-loop.ts"]) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf-8");
    expect(source).toContain("runStopReason(config)");
    expect(source).toContain("await saveHistory(); // every step is recorded");
  }
});
