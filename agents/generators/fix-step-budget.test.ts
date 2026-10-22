import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

// 2026-10-22 (Trailhead rerun): a backend fix round was asked to batch the booking-items insert, wrote it with "(1, 2, 3, 4)"
// instead of "($1, $2, $3, $4)", spent its steps on the required live check, found its own bug at step 40 and stopped there:
// 40 is the generic default, while a generation phase (same live-verification work) was tuned up to 90 from real overruns.
// The half-made change stayed and the review saw the bug again. Fix rounds now get 60 steps.
for (const agent of ["shubham", "aanya"]) {
  test(`${agent}'s fix rounds get their own step budget of 60`, () => {
    const src = readFileSync(new URL(`./${agent}/src/index.ts`, import.meta.url), "utf-8");
    expect(src).toContain("export const FIX_MAX_STEPS = 60;");
    const fix = src.slice(src.indexOf("export async function runFix"));
    expect(fix.slice(0, fix.indexOf("});"))).toContain("maxIterations: FIX_MAX_STEPS");
  });
}
