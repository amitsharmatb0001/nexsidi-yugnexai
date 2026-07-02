// Orchestrator entry point — wires Stages 1-3 together with checkpointing.
//
// Split into two functions on purpose:
//   - runPipelineWithStages: pure sequencing/gating logic, takes stage
//     implementations as injected params. This is what run.test.ts exercises
//     with deterministic stubs — no real LLM calls.
//   - runPipeline: the real entry point. Loads the real stage modules via
//     dynamic import so that importing this file (e.g. from tests) never
//     transitively pulls in Saanvi/Aanya's real agent code, which calls live
//     LLMs and isn't safe to load at module-eval time in a test run.
import { writeCheckpoint } from "./checkpoint.ts";
import type { GatewayDecision } from "./types.ts";

export interface Stage1Output {
  spec: unknown;
}

export interface Stage3Output {
  locked: boolean;
  outputDir: string;
}

export interface PipelineStages {
  stage1: (projectId: string, userInput: string) => Promise<Stage1Output>;
  stage2: (projectId: string, spec: unknown) => Promise<GatewayDecision>;
  stage3: (projectId: string, plan: unknown) => Promise<Stage3Output>;
}

/**
 * Runs Stage 1 -> Stage 2 (approval gate) -> Stage 3 (build + approval gate)
 * using injected stage implementations, checkpointing the result of each
 * stage as it completes. If Stage 2's decision is not "proceed", the
 * pipeline stops before Stage 3 ever runs.
 *
 * NOTE: Stage 3 is currently invoked with Stage 1's `spec` as its `plan`
 * argument — there is no Arjun (BuildPlan) stage wired in yet. See the
 * KNOWN GAP comment in ./stages/stage3-ui-preview.ts.
 */
export async function runPipelineWithStages(
  projectId: string,
  userInput: string,
  stages: PipelineStages
): Promise<void> {
  const stage1Result = await stages.stage1(projectId, userInput);
  writeCheckpoint(projectId, "01-requirements", stage1Result);

  const decision = await stages.stage2(projectId, stage1Result.spec);
  writeCheckpoint(projectId, "02-gateway", decision);

  if (decision.decision !== "proceed") {
    return; // blocked — stage3 does not run
  }

  const stage3Result = await stages.stage3(projectId, stage1Result.spec);
  writeCheckpoint(projectId, "03-ui-preview", stage3Result);
}

/** Real entry point — wires the actual Stage 1-3 implementations. */
export async function runPipeline(projectId: string, userInput: string): Promise<void> {
  const [{ runStage1 }, { runStage2 }, { runStage3 }] = await Promise.all([
    import("./stages/stage1-requirements.ts"),
    import("./stages/stage2-gateway.ts"),
    import("./stages/stage3-ui-preview.ts"),
  ]);

  await runPipelineWithStages(projectId, userInput, {
    stage1: runStage1,
    stage2: runStage2,
    stage3: runStage3,
  });
}
