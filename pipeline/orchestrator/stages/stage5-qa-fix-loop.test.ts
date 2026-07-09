import { expect, test } from "bun:test";
import { runQAFixLoopWithDeps, type QAFixDeps } from "./stage5-qa-fix-loop.ts";
import type { Stage4Result } from "./stage4-multi-agent-dev.ts";
import type { Stage5Result } from "./stage5-adversarial-qa.ts";

// A6 (full-system audit, Phase C): run.ts's own comment documented the gap
// this closes — "a fault-isolated re-fix-and-retest loop ... is NOT
// implemented here." This is the deterministic orchestration core (matches
// runStage5WithAgents's DI pattern): injected stub stage5/fix functions, no
// live LLM calls. The real entry point (runQAFixLoop) wires the actual
// runStage5 + Shubham/Aanya's runFix.

const STAGE4_RESULT: Stage4Result = {
  backendOutputDir: "C:/tmp/nexsidi-builds/test-proj/backend",
  frontendOutputDir: "C:/tmp/nexsidi-builds/test-proj/frontend",
  filesWritten: ["backend/src/index.ts", "frontend/app/page.tsx"],
};

const PLAN = { projectId: "test-proj" } as never; // BuildPlan fields beyond projectId are unused by the loop itself

function passResult(): Stage5Result {
  return { pass: true, findings: [] };
}

function prefixForAgent(agent: string): string {
  if (agent === "aanya") return "frontend";
  if (agent === "pranav") return "db";
  return "backend";
}

function failResult(findingCount: number, faultAgent: string): Stage5Result {
  const prefix = prefixForAgent(faultAgent);
  return {
    pass: false,
    faultAgent,
    findings: Array.from({ length: findingCount }, (_, i) => ({
      file: `${prefix}/file${i}.ts`,
      issue: `issue ${i}`,
    })),
  };
}

test("passes on the first QA run -> no fix is ever called, iterations is 1", async () => {
  let fixCalled = false;
  const deps: QAFixDeps = {
    runStage5: async () => passResult(),
    fixShubham: async () => {
      fixCalled = true;
      return { success: true };
    },
    fixAanya: async () => {
      fixCalled = true;
      return { success: true };
    },
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(fixCalled).toBe(false);
  expect(result.pass).toBe(true);
  expect(result.iterations).toBe(1);
});

test("fails once, faultAgent is shubham -> fixShubham is called, then re-passes on retest", async () => {
  let qaCallCount = 0;
  const captured: { findings: string[] } = { findings: [] };
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      return qaCallCount === 1 ? failResult(3, "shubham") : passResult();
    },
    fixShubham: async (_plan, findings) => {
      captured.findings = findings;
      return { success: true };
    },
    fixAanya: async () => ({ success: true }),
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(qaCallCount).toBe(2);
  expect(captured.findings).toEqual(["backend/file0.ts: issue 0", "backend/file1.ts: issue 1", "backend/file2.ts: issue 2"]);
  expect(result.pass).toBe(true);
  expect(result.iterations).toBe(2);
});

test("fails with faultAgent aanya -> fixAanya is called, not fixShubham", async () => {
  let qaCallCount = 0;
  let shubhamCalled = false;
  let aanyaCalled = false;
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      return qaCallCount === 1 ? failResult(1, "aanya") : passResult();
    },
    fixShubham: async () => {
      shubhamCalled = true;
      return { success: true };
    },
    fixAanya: async () => {
      aanyaCalled = true;
      return { success: true };
    },
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(aanyaCalled).toBe(true);
  expect(shubhamCalled).toBe(false);
  expect(result.pass).toBe(true);
});

test("faultAgent pranav has no auto-fix path yet -> loop stops immediately, marked stuck, does not call any fix function", async () => {
  let shubhamCalled = false;
  let aanyaCalled = false;
  const deps: QAFixDeps = {
    runStage5: async () => failResult(1, "pranav"),
    fixShubham: async () => {
      shubhamCalled = true;
      return { success: true };
    },
    fixAanya: async () => {
      aanyaCalled = true;
      return { success: true };
    },
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(shubhamCalled).toBe(false);
  expect(aanyaCalled).toBe(false);
  expect(result.pass).toBe(false);
  expect(result.stuck).toBe(true);
  expect(result.iterations).toBe(1);
});

test("finding count strictly decreasing across fix attempts keeps the loop going, up to the iteration cap", async () => {
  let qaCallCount = 0;
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      // 5 -> 3 -> 1 -> pass: genuine improvement every round, never stuck
      if (qaCallCount === 1) return failResult(5, "shubham");
      if (qaCallCount === 2) return failResult(3, "shubham");
      if (qaCallCount === 3) return failResult(1, "shubham");
      return passResult();
    },
    fixShubham: async () => ({ success: true }),
    fixAanya: async () => ({ success: true }),
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(qaCallCount).toBe(4);
  expect(result.pass).toBe(true);
  expect(result.stuck).toBe(false);
});

test("2 consecutive fix attempts with no reduction in finding count -> stuck, loop stops without exhausting the max iteration cap", async () => {
  let qaCallCount = 0;
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      // 4 -> 4 -> 4: never improves, should stop after the 2nd no-improvement in a row
      return failResult(4, "shubham");
    },
    fixShubham: async () => ({ success: true }),
    fixAanya: async () => ({ success: true }),
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(result.pass).toBe(false);
  expect(result.stuck).toBe(true);
  expect(qaCallCount).toBeLessThan(10); // stopped well before any runaway loop
});

test("never exceeds the max fix-iteration cap even if findings keep barely improving each round", async () => {
  let qaCallCount = 0;
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      // Improves by exactly 1 every round forever — would loop indefinitely
      // without a hard cap.
      return failResult(Math.max(1, 20 - qaCallCount), "shubham");
    },
    fixShubham: async () => ({ success: true }),
    fixAanya: async () => ({ success: true }),
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(result.pass).toBe(false);
  expect(qaCallCount).toBe(6); // exactly 1 initial + MAX_FIX_ITERATIONS(5) retests, never more
});

// Real 2026-07-06 stress-test bug: a live run had findings spanning BOTH
// backend/ and frontend/ files in the same QA pass. The old implementation
// used Stage5Result.faultAgent (identifyFaultAgent's single first-match
// result) to pick ONE agent per round — since the first finding was a
// backend/ file, it fixed Shubham every round and never touched Aanya's
// frontend finding, no matter how many retries ran. The loop must route each
// agent its OWN subset of findings in the same round.
test("findings spanning both backend and frontend in the same round -> BOTH fixShubham and fixAanya are called with their own subset", async () => {
  let qaCallCount = 0;
  let capturedShubham: string[] = [];
  let capturedAanya: string[] = [];
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      if (qaCallCount === 1) {
        return {
          pass: false,
          findings: [
            { file: "backend/src/index.ts", issue: "missing CSRF protection" },
            { file: "frontend/components/TaskForm.tsx", issue: "missing input sanitization" },
          ],
        };
      }
      return passResult();
    },
    fixShubham: async (_plan, findings) => {
      capturedShubham = findings;
      return { success: true };
    },
    fixAanya: async (_plan, findings) => {
      capturedAanya = findings;
      return { success: true };
    },
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(capturedShubham).toEqual(["backend/src/index.ts: missing CSRF protection"]);
  expect(capturedAanya).toEqual(["frontend/components/TaskForm.tsx: missing input sanitization"]);
  expect(result.pass).toBe(true);
});

test("mixed shubham+pranav findings -> fixShubham runs for its own subset; the loop doesn't stop immediately just because pranav has no fixer", async () => {
  let qaCallCount = 0;
  let shubhamCalled = false;
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      if (qaCallCount === 1) {
        return {
          pass: false,
          findings: [
            { file: "backend/src/index.ts", issue: "missing CSRF protection" },
            { file: "db/migrations/0001.sql", issue: "missing index" },
          ],
        };
      }
      // Shubham's part got fixed; only the unfixable pranav finding remains.
      return { pass: false, findings: [{ file: "db/migrations/0001.sql", issue: "missing index" }] };
    },
    fixShubham: async () => {
      shubhamCalled = true;
      return { success: true };
    },
    fixAanya: async () => ({ success: true }),
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(shubhamCalled).toBe(true);
  // Second round: only the pranav finding remains, no fixable agent left -> stop, stuck.
  expect(result.pass).toBe(false);
  expect(result.stuck).toBe(true);
  expect(qaCallCount).toBe(2);
});

// 2026-07-08: Patent Claim 2's instinct memory had a real DB table but
// nothing ever wrote to it. recordInstincts is called BEFORE the fix (so a
// mistake is recorded even if the fix itself doesn't fully resolve it), for
// every agent that has findings this round.
test("recordInstincts is called with each fixable agent's findings, before that agent's fix runs", async () => {
  let qaCallCount = 0;
  const recorded: Array<{ agentName: string; findings: string[] }> = [];
  const callOrder: string[] = [];
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      if (qaCallCount === 1) {
        return {
          pass: false,
          findings: [
            { file: "backend/src/index.ts", issue: "missing CSRF protection" },
            { file: "frontend/components/TaskForm.tsx", issue: "missing input sanitization" },
          ],
        };
      }
      return passResult();
    },
    fixShubham: async () => {
      callOrder.push("fixShubham");
      return { success: true };
    },
    fixAanya: async () => {
      callOrder.push("fixAanya");
      return { success: true };
    },
    recordInstincts: async (agentName, findings) => {
      callOrder.push(`recordInstincts:${agentName}`);
      recorded.push({ agentName, findings });
    },
  };

  await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(recorded).toEqual([
    { agentName: "shubham", findings: ["backend/src/index.ts: missing CSRF protection"] },
    { agentName: "aanya", findings: ["frontend/components/TaskForm.tsx: missing input sanitization"] },
  ]);
  expect(callOrder).toEqual(["recordInstincts:shubham", "fixShubham", "recordInstincts:aanya", "fixAanya"]);
});

test("omitting recordInstincts entirely does not throw — existing callers without memory keep working", async () => {
  let qaCallCount = 0;
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      return qaCallCount === 1 ? failResult(1, "shubham") : passResult();
    },
    fixShubham: async () => ({ success: true }),
    fixAanya: async () => ({ success: true }),
    // no recordInstincts
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);
  expect(result.pass).toBe(true);
});
