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
