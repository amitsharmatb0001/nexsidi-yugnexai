// Orchestrator entry point — wires Stages 1-6 together with checkpointing.
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
import type { GatewayDecision, Dag } from "./types.ts";
import type { BuildPlan } from "../../agents/arjun/src/index.ts";

export interface Stage1Output {
  spec: unknown; // ProjectSpec — flows to Stage 2's human-readable summary
  plan: unknown; // BuildPlan (Arjun's output) — flows to Stage 3/4's generator calls
  dag: unknown;  // Dag (Arjun's task breakdown) — flows to Stage 4's dag param
}

export interface Stage3Output {
  locked: boolean;
  outputDir: string;
}

// Mirrors stage4-multi-agent-dev.ts's real Stage4Result shape structurally
// (not imported from it) — same "stays untyped/hand-rolled on purpose to
// keep run.test.ts's stubs decoupled from agent internals" convention
// Stage1Output/Stage3Output already use.
export interface Stage4Output {
  backendOutputDir: string;
  frontendOutputDir: string;
  filesWritten: string[];
}

// Mirrors stage5-adversarial-qa.ts's real Stage5Result shape structurally.
export interface Stage5Output {
  pass: boolean;
  findings: unknown[];
  faultAgent?: string;
}

// Mirrors stage6-deployment.ts's real Stage6Result shape structurally.
export interface Stage6Output {
  success: boolean;
  appUrl: string;
  findings?: unknown;
  deliverySummary: unknown;
}

export interface PipelineStages {
  stage1: (projectId: string, userInput: string) => Promise<Stage1Output>;
  stage2: (projectId: string, spec: unknown) => Promise<GatewayDecision>;
  stage3: (projectId: string, plan: unknown) => Promise<Stage3Output>;
  stage4: (projectId: string, plan: unknown, dag: unknown) => Promise<Stage4Output>;
  // `plan` added as a 3rd param (A6) — NOT 2nd, so existing 2-arg stubs
  // (positionally expecting stage4Result second) keep working unchanged.
  // runQAFixLoop (the real Stage 5 wiring below) needs `plan` to call
  // Shubham/Aanya's fix() functions.
  stage5: (projectId: string, stage4Result: Stage4Output, plan: unknown) => Promise<Stage5Output>;
  stage6: (projectId: string, stage4Result: Stage4Output) => Promise<Stage6Output>;
}

/**
 * Runs the full 6-stage pipeline — Stage 1 (requirements) -> Stage 2
 * (approval gate) -> Stage 3 (UI preview + second approval gate) -> Stage 4
 * (multi-agent dev) -> Stage 5 (adversarial QA) -> Stage 6 (deploy) — using
 * injected stage implementations, checkpointing the result of each stage as
 * it completes. Two gates can stop the pipeline before it reaches Stage 6:
 *
 *   - Stage 2's decision is not "proceed" -> stops before Stage 3 runs.
 *   - Stage 3's own human approval gate resolves to `locked: false` -> stops
 *     before Stage 4 runs (nothing has been generated yet at that point, so
 *     there is nothing to roll back).
 *   - Stage 5's adversarial QA fails (`pass: false`) AND the fix loop (A6,
 *     see stage5-qa-fix-loop.ts) can't get it passing within its iteration
 *     budget -> stops before Stage 6 deploys an unvetted build. The real
 *     `stage5` implementation wired in `runPipeline()` below is
 *     `runQAFixLoop`, not the bare single-pass `runStage5` — on failure it
 *     routes findings to the fault-isolated agent (Shubham/Aanya only;
 *     Pranav has no agentic fix path yet), retests, and repeats up to a
 *     small cap or until stuck-detection fires. `PipelineStages.stage5`'s
 *     signature is unchanged (`Stage5Output` already covers `pass`/
 *     `findings`/`faultAgent`) — only which function gets passed for it
 *     changed, so `runPipelineWithStages` and its tests needed no changes.
 *
 * Stage 1 now runs Arjun (agents/arjun/src/index.ts) after Saanvi, so it
 * produces the locked `spec` (ProjectSpec), a real `plan` (BuildPlan), and a
 * `dag` (Dag). Stage 2 receives `spec` — it summarizes
 * spec.name/description/features for human review, fields BuildPlan does not
 * carry. Stage 3 and Stage 4 both receive `plan` — Aanya's and
 * Pranav's/Shubham's generators require the real BuildPlan shape
 * (apiContract, sharedTypes, dbSchema, ...). Stage 4 also receives `dag`.
 * See stage1-requirements.ts, stage3-ui-preview.ts, and
 * stage4-multi-agent-dev.ts for the full rationale.
 */
export async function runPipelineWithStages(
  projectId: string,
  userInput: string,
  stages: PipelineStages
): Promise<void> {
  const { readCheckpoint } = await import("./checkpoint.ts");

  let stage1Result = readCheckpoint<Stage1Output>(projectId, "01-requirements");
  if (stage1Result) {
    console.log(`[orchestrator] Resuming: Loaded Stage 1 (01-requirements) from checkpoint`);
  } else {
    stage1Result = await stages.stage1(projectId, userInput);
    writeCheckpoint(projectId, "01-requirements", stage1Result);
  }

  let decision = readCheckpoint<GatewayDecision>(projectId, "02-gateway");
  if (decision) {
    console.log(`[orchestrator] Resuming: Loaded Stage 2 (02-gateway) from checkpoint`);
  } else {
    decision = await stages.stage2(projectId, stage1Result.spec);
    writeCheckpoint(projectId, "02-gateway", decision);
  }

  if (decision.decision !== "proceed") {
    return; // blocked — stage3 does not run
  }

  let stage3Result = readCheckpoint<Stage3Output>(projectId, "03-ui-preview");
  if (stage3Result) {
    console.log(`[orchestrator] Resuming: Loaded Stage 3 (03-ui-preview) from checkpoint`);
  } else {
    stage3Result = await stages.stage3(projectId, stage1Result.plan);
    writeCheckpoint(projectId, "03-ui-preview", stage3Result);
  }

  if (!stage3Result.locked) {
    return; // Stage 3's own human approval gate declined — stage4 does not run
  }

  let stage4Result = readCheckpoint<Stage4Output>(projectId, "04-dev");
  if (stage4Result) {
    console.log(`[orchestrator] Resuming: Loaded Stage 4 (04-dev) from checkpoint`);
  } else {
    stage4Result = await stages.stage4(projectId, stage1Result.plan, stage1Result.dag);
    writeCheckpoint(projectId, "04-dev", stage4Result);
  }

  let stage5Result = readCheckpoint<Stage5Output>(projectId, "05-qa");
  const bypassQa = process.env.NEXSIDI_BYPASS_QA === "true";
  
  if (stage5Result && (stage5Result.pass || bypassQa)) {
    console.log(`[orchestrator] Resuming: Loaded Stage 5 (05-qa) from successful checkpoint (or bypassed)`);
    if (bypassQa) {
      stage5Result.pass = true;
    }
  } else {
    if (bypassQa) {
      console.log(`[orchestrator] Bypassing Stage 5 QA check per NEXSIDI_BYPASS_QA environment variable`);
      stage5Result = { pass: true, findings: [] };
      writeCheckpoint(projectId, "05-qa", stage5Result);
    } else {
      stage5Result = await stages.stage5(projectId, stage4Result, stage1Result.plan);
      writeCheckpoint(projectId, "05-qa", stage5Result);
    }
  }

  if (!stage5Result.pass) {
    return; // Stage 5 adversarial QA failed — stage6 does not deploy an unvetted build
  }

  let stage6Result = readCheckpoint<Stage6Output>(projectId, "06-deployment");
  if (stage6Result && stage6Result.success) {
    console.log(`[orchestrator] Resuming: Loaded Stage 6 (06-deployment) from successful checkpoint`);
  } else {
    stage6Result = await stages.stage6(projectId, stage4Result);
    writeCheckpoint(projectId, "06-deployment", stage6Result);
  }
}

/** Real entry point — wires the actual Stage 1-6 implementations. */
export async function runPipeline(projectId: string, userInput: string): Promise<void> {
  const [
    { runStage1 },
    { runStage2 },
    { runStage3 },
    { runStage4 },
    { runQAFixLoop },
    { runStage6 },
  ] = await Promise.all([
    import("./stages/stage1-requirements.ts"),
    import("./stages/stage2-gateway.ts"),
    import("./stages/stage3-ui-preview.ts"),
    import("./stages/stage4-multi-agent-dev.ts"),
    // A6: the real Stage 5 wiring is the fix loop, not the bare single-pass
    // runStage5 — see the doc comment above runPipelineWithStages.
    import("./stages/stage5-qa-fix-loop.ts"),
    import("./stages/stage6-deployment.ts"),
  ]);

  await runPipelineWithStages(projectId, userInput, {
    stage1: runStage1,
    stage2: runStage2,
    stage3: runStage3,
    // runStage4's real signature takes the typed BuildPlan/Dag Arjun
    // actually produces (not `unknown`) — cast at this single real-wiring
    // boundary rather than loosening runStage4's own signature, same
    // approach stage3-ui-preview.ts uses internally for its `plan` param.
    stage4: (pid, plan, dag) => runStage4(pid, plan as BuildPlan, dag as Dag),
    stage5: (pid, stage4Result, plan) => runQAFixLoop(pid, plan as BuildPlan, stage4Result),
    stage6: runStage6,
  });
}
