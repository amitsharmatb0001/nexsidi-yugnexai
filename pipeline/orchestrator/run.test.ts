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
      return { spec: { name: "test spec" }, plan: { appName: "test spec" } };
    },
    stage2: async (): Promise<GatewayDecision> => {
      calls.push("stage2");
      return { decision: "proceed" };
    },
    stage3: async () => {
      calls.push("stage3");
      return { locked: true, outputDir: "C:/tmp/nexsidi-builds/test-orchestrator-proj/frontend" };
    },
  });

  expect(calls).toEqual(["stage1", "stage2", "stage3"]);
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
    }),
    stage2: async (_projectId, spec): Promise<GatewayDecision> => {
      receivedByStage2.push(spec);
      return { decision: "proceed" };
    },
    stage3: async (_projectId, plan) => {
      receivedByStage3.push(plan);
      return { locked: true, outputDir: "C:/tmp/out" };
    },
  });

  expect(receivedByStage2).toEqual([{ name: "spec-from-stage1" }]);
  expect(receivedByStage3).toEqual([{ appName: "plan-from-stage1" }]);

  cleanup();
});
