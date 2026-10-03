import { test, expect } from "bun:test";
import { buildFixTask as frontendFixTask } from "./index.ts";
import { buildFixTask as backendFixTask } from "../../shubham/src/index.ts";

// 2026-10-03 (evidence-only plan, T5; Ledgerly run 4): findings were handed
// over as "ISSUES TO FIX" and the frontend builder changed a correct theme to
// satisfy a false one. Every fix task now starts by confirming each finding
// against the code or the running app, and a finding the facts disprove is
// disputed, not "fixed".
const plan = { projectId: "p1", spec: {}, tasks: [], apiContract: { endpoints: [] }, dbSchema: { tables: [] } } as never;

for (const [name, build] of [["frontend", frontendFixTask], ["backend", backendFixTask]] as const) {
  test(`${name} fix task: confirm each finding first, dispute it with the facts if it is not true`, () => {
    const task = build(["frontend/app/layout.tsx: colour #059669 missing"], plan);
    expect(task).toContain("FINDINGS TO CHECK");
    expect(task).not.toContain("ISSUES TO FIX");
    expect(task).toMatch(/confirm/i);
    expect(task).toContain("dispute_finding");
    // confirming comes before editing
    expect(task.indexOf("dispute_finding")).toBeLessThan(task.indexOf("edit_file"));
  });
}
