import { test, expect } from "bun:test";
import { buildFixTask } from "./index.ts";

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
