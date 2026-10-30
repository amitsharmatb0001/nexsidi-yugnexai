import { test, expect } from "bun:test";
import { fixRunUnaccounted } from "./fix-accounting.ts";
import { readFileSync } from "node:fs";

// 2026-10-04 (Ledgerly run 4, overnight): a fix run checked a finding, found
// the form worked, said so in its summary, changed nothing and finished. No
// dispute was recorded, so the finding came back every round and the stage
// looped. A fix run now finishes only when it has fixed something, disputed a
// finding with evidence, or handed one to its owner — counted, not read from
// its summary.
test("a fix run that changed nothing and disputed nothing cannot finish", () => {
  expect(fixRunUnaccounted({ filesWritten: 0, disputes: 0, escalations: 0 })).toContain("dispute_finding");
});

test("a fix run that fixed, disputed or escalated can finish", () => {
  expect(fixRunUnaccounted({ filesWritten: 1, disputes: 0, escalations: 0 })).toBeNull();
  expect(fixRunUnaccounted({ filesWritten: 0, disputes: 1, escalations: 0 })).toBeNull();
  expect(fixRunUnaccounted({ filesWritten: 0, disputes: 0, escalations: 1 })).toBeNull();
});

test("all three agent loops apply it to fix runs before accepting task_complete", () => {
  for (const f of ["../loop.ts", "../gemini-loop.ts", "../claude-loop.ts"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf-8");
    expect({ f, wired: src.includes("fixRunUnaccounted(") }).toEqual({ f, wired: true });
  }
});

// 2026-10-30 (team plan, stage 4): the acceptance gate's finish check rebuilds the app; it runs only when the builder's own
// checks already pass.
import { withExtraChecks } from "./fix-accounting.ts";
test("the extra finish check runs only after the builder's own checks pass", async () => {
  let ran = 0;
  const extra = { exitChecks: async () => (ran++, ["AT-1-1 still fails"]) };
  expect(await withExtraChecks(["tsc: 2 errors"], extra)).toEqual(["tsc: 2 errors"]);
  expect(ran).toBe(0);
  expect(await withExtraChecks(Promise.resolve([]), extra)).toEqual(["AT-1-1 still fails"]);
  expect(await withExtraChecks([], undefined)).toEqual([]);
});
