import { test, expect } from "bun:test";
import { runPipelineWithStages } from "./run.ts";
import { readCheckpoint } from "./checkpoint.ts";
import { rmSync } from "fs";
import { join } from "path";
import type { GatewayDecision } from "./types.ts";

const TEST_PROJECT = "test-orchestrator-proj";
const BUILD_DIR = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";

function cleanup(): void {
  rmSync(join(BUILD_DIR, TEST_PROJECT), { recursive: true, force: true });
}

// Shared stage4/stage6 stub results — the real stage modules are covered by
// their own stage4/5/6-*.test.ts files with injected stubs; these constants
// just give the Stage 1-3 tests below (which now flow into 4-6 once Stage 3
// locks) a deterministic, minimal Stage 4/6 shape to pass through.
const STAGE4_STUB_RESULT = {
  backendOutputDir: "C:/tmp/out/backend",
  frontendOutputDir: "C:/tmp/out/frontend",
  filesWritten: ["backend/src/index.ts"],
};

const STAGE6_STUB_RESULT = {
  success: true,
  appUrl: "http://localhost:3200",
  deliverySummary: { status: "delivered", appUrl: "http://localhost:3200", githubRepo: null },
};

test("runPipelineWithStages checkpoints after each stage and stops at an unapproved gateway", async () => {
  cleanup();
  const calls: string[] = [];

  await runPipelineWithStages(TEST_PROJECT, "build me a task manager", {
    stage1: async () => {
      calls.push("stage1");
      return { spec: { name: "test spec" }, plan: { appName: "test spec" } };
    },
    stage2: async (): Promise<GatewayDecision> => {
      calls.push("stage2");
      return { decision: "review", feedback: "change the color" }; // user requests changes
    },
    stage3: async () => {
      calls.push("stage3");
      return { locked: true, outputDir: "C:/tmp/nexsidi-builds/test-orchestrator-proj/frontend" };
    },
  });

  expect(calls).toEqual(["stage1", "stage2"]); // stage3 never runs — gate blocked it
  expect(readCheckpoint(TEST_PROJECT, "01-requirements")).toEqual({
    spec: { name: "test spec" },
    plan: { appName: "test spec" },
  });
  expect(readCheckpoint(TEST_PROJECT, "02-gateway")).toEqual({
    decision: "review",
    feedback: "change the color",
  });
  expect(readCheckpoint(TEST_PROJECT, "03-ui-preview")).toBeNull();

  cleanup();
});

test("runPipelineWithStages lets stage3 run when stage2 decides proceed", async () => {
  cleanup();
  const calls: string[] = [];

  await runPipelineWithStages(TEST_PROJECT, "build me a task manager", {
    stage1: async () => {
      calls.push("stage1");
      return { spec: { name: "test spec" }, plan: { appName: "test spec" }, dag: { tasks: [] } };
    },
    stage2: async (): Promise<GatewayDecision> => {
      calls.push("stage2");
      return { decision: "proceed" };
    },
    stage3: async () => {
      calls.push("stage3");
      return { locked: true, outputDir: "C:/tmp/nexsidi-builds/test-orchestrator-proj/frontend" };
    },
    // Stage 3 locked -> the pipeline continues into 4-6; these stubs exist
    // only so this test's stage1-3 assertions aren't disturbed by that.
    // Stage 4-6-specific behavior is covered by the dedicated tests below.
    stage4: async () => {
      calls.push("stage4");
      return STAGE4_STUB_RESULT;
    },
    stage5: async () => {
      calls.push("stage5");
      return { pass: true, findings: [] };
    },
    stage6: async () => {
      calls.push("stage6");
      return STAGE6_STUB_RESULT;
    },
  });

  expect(calls).toEqual(["stage1", "stage2", "stage3", "stage4", "stage5", "stage6"]);
  expect(readCheckpoint(TEST_PROJECT, "02-gateway")).toEqual({ decision: "proceed" });
  expect(readCheckpoint(TEST_PROJECT, "03-ui-preview")).toEqual({
    locked: true,
    outputDir: "C:/tmp/nexsidi-builds/test-orchestrator-proj/frontend",
  });

  cleanup();
});

test("runPipelineWithStages passes stage1's spec to stage2 and stage1's plan to stage3", async () => {
  cleanup();
  const receivedByStage2: unknown[] = [];
  const receivedByStage3: unknown[] = [];

  await runPipelineWithStages(TEST_PROJECT, "build me a task manager", {
    stage1: async () => ({
      spec: { name: "spec-from-stage1" },
      plan: { appName: "plan-from-stage1" },
      dag: { tasks: [] },
    }),
    stage2: async (_projectId, spec): Promise<GatewayDecision> => {
      receivedByStage2.push(spec);
      return { decision: "proceed" };
    },
    stage3: async (_projectId, plan) => {
      receivedByStage3.push(plan);
      return { locked: true, outputDir: "C:/tmp/out" };
    },
    stage4: async () => STAGE4_STUB_RESULT,
    stage5: async () => ({ pass: true, findings: [] }),
    stage6: async () => STAGE6_STUB_RESULT,
  });

  expect(receivedByStage2).toEqual([{ name: "spec-from-stage1" }]);
  expect(receivedByStage3).toEqual([{ appName: "plan-from-stage1" }]);

  cleanup();
});

// ── Stage 4-6 wiring ─────────────────────────────────────────────────────────
// The real stage modules (Pranav/Shubham/Aanya's generators, Navya/Karan/
// Deepika/Tier3's adversarial QA, Riya's deploy) are covered by their own
// stage4/5/6-*.test.ts files with injected stubs. These tests only exercise
// runPipelineWithStages' own sequencing/gating/checkpointing/data-threading
// logic across all 6 stages, with deterministic full-literal stubs matching
// the style of the Stage 1-3 tests above.
test("runPipelineWithStages runs all six stages in order and checkpoints each one when everything proceeds", async () => {
  cleanup();
  const calls: string[] = [];

  await runPipelineWithStages(TEST_PROJECT, "build me a task manager", {
    stage1: async () => {
      calls.push("stage1");
      return { spec: { name: "test spec" }, plan: { appName: "test spec" }, dag: { tasks: [] } };
    },
    stage2: async (): Promise<GatewayDecision> => {
      calls.push("stage2");
      return { decision: "proceed" };
    },
    stage3: async () => {
      calls.push("stage3");
      return { locked: true, outputDir: "C:/tmp/out" };
    },
    stage4: async () => {
      calls.push("stage4");
      return STAGE4_STUB_RESULT;
    },
    stage5: async () => {
      calls.push("stage5");
      return { pass: true, findings: [] };
    },
    stage6: async () => {
      calls.push("stage6");
      return STAGE6_STUB_RESULT;
    },
  });

  expect(calls).toEqual(["stage1", "stage2", "stage3", "stage4", "stage5", "stage6"]);
  expect(readCheckpoint(TEST_PROJECT, "01-requirements")).not.toBeNull();
  expect(readCheckpoint(TEST_PROJECT, "02-gateway")).toEqual({ decision: "proceed" });
  expect(readCheckpoint(TEST_PROJECT, "03-ui-preview")).toEqual({ locked: true, outputDir: "C:/tmp/out" });
  expect(readCheckpoint(TEST_PROJECT, "04-dev")).toEqual(STAGE4_STUB_RESULT);
  expect(readCheckpoint(TEST_PROJECT, "05-qa")).toEqual({ pass: true, findings: [] });
  expect(readCheckpoint(TEST_PROJECT, "06-deployment")).toEqual(STAGE6_STUB_RESULT);

  cleanup();
});

test("runPipelineWithStages does not run stage4 when stage3's gate declines (locked: false)", async () => {
  cleanup();
  const calls: string[] = [];

  await runPipelineWithStages(TEST_PROJECT, "build me a task manager", {
    stage1: async () => ({ spec: { name: "test spec" }, plan: { appName: "test spec" }, dag: { tasks: [] } }),
    stage2: async (): Promise<GatewayDecision> => ({ decision: "proceed" }),
    stage3: async () => {
      calls.push("stage3");
      return { locked: false, outputDir: "C:/tmp/out" };
    },
    stage4: async () => {
      calls.push("stage4");
      return STAGE4_STUB_RESULT;
    },
    stage5: async () => {
      calls.push("stage5");
      return { pass: true, findings: [] };
    },
    stage6: async () => {
      calls.push("stage6");
      return STAGE6_STUB_RESULT;
    },
  });

  expect(calls).toEqual(["stage3"]); // stage4 never runs
  expect(readCheckpoint(TEST_PROJECT, "03-ui-preview")).toEqual({ locked: false, outputDir: "C:/tmp/out" });
  expect(readCheckpoint(TEST_PROJECT, "04-dev")).toBeNull();
  expect(readCheckpoint(TEST_PROJECT, "05-qa")).toBeNull();
  expect(readCheckpoint(TEST_PROJECT, "06-deployment")).toBeNull();

  cleanup();
});

test("runPipelineWithStages does not run stage6 when stage5's adversarial QA fails", async () => {
  cleanup();
  const calls: string[] = [];

  await runPipelineWithStages(TEST_PROJECT, "build me a task manager", {
    stage1: async () => ({ spec: { name: "test spec" }, plan: { appName: "test spec" }, dag: { tasks: [] } }),
    stage2: async (): Promise<GatewayDecision> => ({ decision: "proceed" }),
    stage3: async () => ({ locked: true, outputDir: "C:/tmp/out" }),
    stage4: async () => {
      calls.push("stage4");
      return STAGE4_STUB_RESULT;
    },
    stage5: async () => {
      calls.push("stage5");
      return {
        pass: false,
        findings: [{ file: "backend/src/index.ts", issue: "SQL injection" }],
        faultAgent: "shubham",
      };
    },
    stage6: async () => {
      calls.push("stage6");
      return STAGE6_STUB_RESULT;
    },
  });

  expect(calls).toEqual(["stage4", "stage5"]); // stage6 never runs
  expect(readCheckpoint(TEST_PROJECT, "05-qa")).toEqual({
    pass: false,
    findings: [{ file: "backend/src/index.ts", issue: "SQL injection" }],
    faultAgent: "shubham",
  });
  expect(readCheckpoint(TEST_PROJECT, "06-deployment")).toBeNull();

  cleanup();
});

test("runPipelineWithStages threads stage1's dag into stage4 and stage4's result into stage5 and stage6", async () => {
  cleanup();
  const receivedByStage4: unknown[] = [];
  const receivedByStage5: unknown[] = [];
  const receivedByStage6: unknown[] = [];
  const dag = { tasks: [{ id: "shubham-0", description: "d", complexity: 1, dependsOn: [] }] };

  await runPipelineWithStages(TEST_PROJECT, "build me a task manager", {
    stage1: async () => ({ spec: { name: "test spec" }, plan: { appName: "plan-from-stage1" }, dag }),
    stage2: async (): Promise<GatewayDecision> => ({ decision: "proceed" }),
    stage3: async () => ({ locked: true, outputDir: "C:/tmp/out" }),
    stage4: async (_projectId, plan, receivedDag) => {
      receivedByStage4.push({ plan, dag: receivedDag });
      return STAGE4_STUB_RESULT;
    },
    stage5: async (_projectId, stage4Result) => {
      receivedByStage5.push(stage4Result);
      return { pass: true, findings: [] };
    },
    stage6: async (_projectId, stage4Result) => {
      receivedByStage6.push(stage4Result);
      return STAGE6_STUB_RESULT;
    },
  });

  expect(receivedByStage4).toEqual([{ plan: { appName: "plan-from-stage1" }, dag }]);
  expect(receivedByStage5).toEqual([STAGE4_STUB_RESULT]);
  expect(receivedByStage6).toEqual([STAGE4_STUB_RESULT]);

  cleanup();
});
