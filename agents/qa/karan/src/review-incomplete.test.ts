import { test, expect } from "bun:test";
import { runExploring as navya } from "../../navya/src/index.ts";
import { runExploring as karan } from "./index.ts";
import { runExploring as deepika } from "../../deepika/src/index.ts";

// 2026-10-03 (evidence-only plan, T2; Ledgerly run 4): the security and
// performance reviews returned zero findings while their model calls were
// failing. A review that ran out of steps, stopped, or got stuck without
// submitting had its errors ignored, so zero findings read as 100/100 clean.
// Not finishing is now "review did not complete", never a pass — and any
// findings it did show to be true are kept.
const unfinished = (errors: string[], findings: unknown[] = []) => ({
  runAgent: async () => ({ findings, iterations: 40, errors, submitted: false }),
}) as never;

for (const [name, run] of [["navya", navya], ["karan", karan], ["deepika", deepika]] as const) {
  for (const why of ["Max iterations reached", "Agent stopped without calling submit_findings", "Stuck: repeated call"]) {
    test(`${name}: a review that ended with "${why}" and no findings is incomplete, not clean`, async () => {
      const r = await run("p1", [], unfinished([why]));
      expect(r.passed).toBe(false);
      expect(JSON.stringify(r.findings)).toMatch(/review did not complete|review-incomplete/);
    });
  }

  test(`${name}: an unfinished review keeps its verified findings and is still incomplete`, async () => {
    const real = { severity: "LOW", category: "x", detail: "real", file: "backend/a.ts", line: 1, evidence: "const a = 1;" };
    const r = await run("p1", [], unfinished(["Max iterations reached"], [real]));
    expect(r.passed).toBe(false);
    expect(JSON.stringify(r.findings)).toContain("real");
    expect(JSON.stringify(r.findings)).toMatch(/review did not complete|review-incomplete/);
  });

  test(`${name}: a finished review with no findings is clean`, async () => {
    const r = await run("p1", [], { runAgent: async () => ({ findings: [], iterations: 9, errors: [], submitted: true }) } as never);
    expect(r.passed).toBe(true);
  });
}
