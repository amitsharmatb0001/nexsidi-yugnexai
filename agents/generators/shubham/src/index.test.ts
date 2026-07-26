import { test, expect } from "bun:test";
import { buildFixTask, renderTaskManifest } from "./index.ts";

// A6 (full-system audit, Phase C): Stage 5 QA findings previously went
// nowhere — the pipeline stopped at Stage 5 with real findings and no
// mechanism to act on them (documented gap in run.ts's own comment above
// stage5's call site). buildFixTask is the pure, testable core of the fix
// prompt handed to runFix() — run() itself calls a live LLM and isn't
// unit-testable, same split as every other agent in this codebase.

test("buildFixTask numbers each finding and instructs targeted fixes, not a rewrite", () => {
  const task = buildFixTask([
    "[security/CRITICAL] backend/src/db/pool.ts: hardcoded fallback credentials",
    "[logic/HIGH] backend/src/controllers/tasks.ts: TOCTOU race in updateTask",
  ]);
  expect(task).toContain("1. [security/CRITICAL] backend/src/db/pool.ts: hardcoded fallback credentials");
  expect(task).toContain("2. [logic/HIGH] backend/src/controllers/tasks.ts: TOCTOU race in updateTask");
  expect(task).toContain("Fix ONLY these specific issues");
  expect(task).not.toContain("write_file for ALL"); // must not read as "regenerate everything"
});

test("buildFixTask instructs verification before task_complete", () => {
  const task = buildFixTask(["some finding"]);
  expect(task.toLowerCase()).toContain("verif");
  expect(task).toContain("task_complete");
});

// P5.W5.1 (full agentic upgrade plan — plan-then-execute): Arjun's BuildPlan
// already produces an exhaustive shubhamTasks manifest ("outputFiles must
// list every file the agent must produce. Be exhaustive.") but buildAgentTask
// never rendered it — Shubham had zero visibility into the exact file list
// Arjun already decomposed, unlike Aanya (whose buildAgentTask already
// renders aanyaTasks as "PLANNED FRONTEND FILES AND PAGES"). Without the
// manifest, the agent has no way to know it's "done writing" other than
// feeling around with tsc after every file — the measured cause of the
// 30-60x per-session tsc/build re-verification tax. renderTaskManifest is
// the pure, testable core of the fix (mirrors Aanya's inline taskDetails map).
test("renderTaskManifest lists every task's description and output files", () => {
  const manifest = renderTaskManifest([
    { description: "Express entry, app setup, JWT middleware", outputFiles: ["src/index.ts", "src/middleware/auth.ts"] },
    { description: "Tasks resource — CRUD endpoints", outputFiles: ["src/routes/tasks.routes.ts", "src/controllers/tasks.ts"] },
  ]);
  expect(manifest).toContain("Task 1: Express entry, app setup, JWT middleware");
  expect(manifest).toContain("- src/index.ts");
  expect(manifest).toContain("- src/middleware/auth.ts");
  expect(manifest).toContain("Task 2: Tasks resource — CRUD endpoints");
  expect(manifest).toContain("- src/routes/tasks.routes.ts");
});

test("renderTaskManifest returns an empty string for an empty/missing task list — never a dangling header", () => {
  expect(renderTaskManifest([])).toBe("");
});
