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
  stage5: (projectId: string, stage4Result: Stage4Output, plan: unknown) => Promise<Stage5Output>;
  stage5_5?: (projectId: string, stage4Result: Stage4Output) => Promise<{ pass: boolean; reason?: string }>;
  stage6: (projectId: string, stage4Result: Stage4Output, plan: unknown) => Promise<Stage6Output>;
}

/**
 * Runs the full 6-stage pipeline using an execution-pointer state machine.
 * Classifies failures (INFRA, PROMPT_FAILURE, CODE_BUG) and implements rollback to previous stages after 3 consecutive failures.
 */
export async function runPipelineWithStages(
  projectId: string,
  userInput: string,
  stages: PipelineStages
): Promise<void> {
  const { readCheckpoint, writeCheckpoint, deleteCheckpoint } = await import("./checkpoint.ts");

  let stage1Result: Stage1Output | null = null;
  let decision: GatewayDecision | null = null;
  let stage3Result: Stage3Output | null = null;
  let stage4Result: Stage4Output | null = null;
  let stage5Result: Stage5Output | null = null;
  let stage6Result: Stage6Output | null = null;

  const stagesList = [
    {
      name: "01-requirements" as const,
      run: async () => {
        stage1Result = await stages.stage1(projectId, userInput);
        writeCheckpoint(projectId, "01-requirements", stage1Result);
      }
    },
    {
      name: "02-gateway" as const,
      run: async () => {
        decision = await stages.stage2(projectId, stage1Result!.spec);
        writeCheckpoint(projectId, "02-gateway", decision);
      }
    },
    {
      name: "03-ui-preview" as const,
      run: async () => {
        stage3Result = await stages.stage3(projectId, stage1Result!.plan);
        writeCheckpoint(projectId, "03-ui-preview", stage3Result);
      }
    },
    {
      name: "04-dev" as const,
      run: async () => {
        stage4Result = await stages.stage4(projectId, stage1Result!.plan, stage1Result!.dag);
        writeCheckpoint(projectId, "04-dev", stage4Result);
      }
    },
    {
      name: "05-qa" as const,
      run: async () => {
        const bypassQa = process.env.NEXSIDI_BYPASS_QA === "true";
        if (bypassQa) {
          console.log(`[orchestrator] Bypassing Stage 5 QA check per env var`);
          stage5Result = { pass: true, findings: [] };
        } else {
          stage5Result = await stages.stage5(projectId, stage4Result!, stage1Result!.plan);
        }
        writeCheckpoint(projectId, "05-qa", stage5Result);
      }
    },
    {
      name: "05b-build-gate" as const,
      run: async () => {
        if (stages.stage5_5) {
          const r = await stages.stage5_5(projectId, stage4Result!);
          writeCheckpoint(projectId, "05b-build-gate", r);
        }
      }
    },
    {
      name: "06-deployment" as const,
      run: async () => {
        stage6Result = await stages.stage6(projectId, stage4Result!, stage1Result!.plan);
        writeCheckpoint(projectId, "06-deployment", stage6Result);
      }
    }
  ];

  const stageRetries: Record<string, number> = {};
  let index = 0;

  while (index < stagesList.length) {
    const currentStage = stagesList[index]!;
    
    // Check if checkpoint exists
    const hasCheckpoint = readCheckpoint<any>(projectId, currentStage.name);
    if (hasCheckpoint) {
      const isSuccessfulQA = currentStage.name === "05-qa" && (hasCheckpoint.pass || process.env.NEXSIDI_BYPASS_QA === "true");
      const isSuccessfulBuildGate = currentStage.name === "05b-build-gate" && hasCheckpoint.pass;
      const isSuccessfulDeploy = currentStage.name === "06-deployment" && hasCheckpoint.success;
      
      const shouldSkip = currentStage.name !== "05-qa" && 
                         currentStage.name !== "05b-build-gate" && 
                         currentStage.name !== "06-deployment" || 
                         isSuccessfulQA || 
                         isSuccessfulBuildGate || 
                         isSuccessfulDeploy;

      if (shouldSkip) {
        console.log(`[orchestrator] Resuming: Loaded Stage ${currentStage.name} from checkpoint`);
        if (currentStage.name === "01-requirements") stage1Result = hasCheckpoint;
        if (currentStage.name === "02-gateway") decision = hasCheckpoint;
        if (currentStage.name === "03-ui-preview") stage3Result = hasCheckpoint;
        if (currentStage.name === "04-dev") stage4Result = hasCheckpoint;
        if (currentStage.name === "05-qa") {
          stage5Result = hasCheckpoint;
          if (process.env.NEXSIDI_BYPASS_QA === "true") stage5Result!.pass = true;
        }
        if (currentStage.name === "06-deployment") stage6Result = hasCheckpoint;
        
        // Check gate conditions
        if (currentStage.name === "02-gateway" && decision!.decision !== "proceed") return;
        if (currentStage.name === "03-ui-preview" && !stage3Result!.locked) return;
        if (currentStage.name === "05-qa" && !stage5Result!.pass && process.env.NEXSIDI_BYPASS_QA !== "true") return;
        if (currentStage.name === "05b-build-gate" && !hasCheckpoint.pass) {
          console.log(`[orchestrator] Loaded Stage 5.5 failed build gate - stopping`);
          return;
        }

        index++;
        continue;
      }
    }

    try {
      await currentStage.run();
      
      // Post-run validation and variable assignments
      if (currentStage.name === "02-gateway" && decision!.decision !== "proceed") return;
      if (currentStage.name === "03-ui-preview" && !stage3Result!.locked) return;
      if (currentStage.name === "05-qa" && !stage5Result!.pass && process.env.NEXSIDI_BYPASS_QA !== "true") return;
      if (currentStage.name === "05b-build-gate") {
        const buildGateRes = readCheckpoint<any>(projectId, "05b-build-gate");
        if (buildGateRes && !buildGateRes.pass) {
          console.log(`[orchestrator] Stage 5.5 build gate FAILED — ${buildGateRes.reason ?? "TypeScript compilation error"}`);
          return;
        }
      }
      
      index++;
    } catch (err: any) {
      const errMsg = err.message || String(err);
      console.error(`[orchestrator] Error in stage ${currentStage.name}: ${errMsg}`);
      
      // Classify error
      const isInfra = errMsg.includes("ECONNREFUSED") || 
                      errMsg.includes("fetch failed") || 
                      errMsg.includes("Docker") || 
                      errMsg.includes("network") || 
                      errMsg.includes("timeout") || 
                      errMsg.includes("rate limit") || 
                      errMsg.includes("overloaded");
                      
      const isPromptFailure = errMsg.includes("JSON") || 
                              errMsg.includes("parse") || 
                              errMsg.includes("could not be parsed") || 
                              errMsg.includes("envelope mismatch") || 
                              errMsg.includes("evidence") || 
                              errMsg.includes("validation");
      
      stageRetries[currentStage.name] = (stageRetries[currentStage.name] || 0) + 1;
      
      if (stageRetries[currentStage.name] >= 3) {
        console.warn(`[orchestrator] Stage ${currentStage.name} failed 3 times. Deleting checkpoint and rolling back...`);
        deleteCheckpoint(projectId, currentStage.name);
        
        // Find previous checkpoint to roll back to
        let prevIdx = index - 1;
        while (prevIdx >= 0) {
          const prevStage = stagesList[prevIdx]!;
          deleteCheckpoint(projectId, prevStage.name);
          stageRetries[prevStage.name] = 0;
          prevIdx--;
        }
        
        // Reset retries and point to start
        stageRetries[currentStage.name] = 0;
        index = 0; 
        continue;
      }
      
      if (isInfra) {
        console.log(`[orchestrator] Infrastructure error detected. Sleeping 30s before retry...`);
        await new Promise(resolve => setTimeout(resolve, 30000));
      } else if (isPromptFailure) {
        console.log(`[orchestrator] Prompt failure detected. Calling meta-supervisor inline...`);
        try {
          const { runMetaSupervisor } = await import("../meta-supervisor.ts");
          await runMetaSupervisor(projectId);
        } catch (supErr) {
          console.error(`[orchestrator] inline meta-supervisor failed: ${String(supErr)}`);
        }
      }
    }
  }
}

// Stage 5.5 real implementation: runs `tsc --noEmit` against backend/ and
// frontend/ in the project build directory.
async function runTypescriptBuildGate(
  projectId: string,
): Promise<{ pass: boolean; reason?: string }> {
  const { spawnSync } = await import("child_process");
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const buildDir = join(process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds", projectId);

  for (const svc of ["backend", "frontend"] as const) {
    const dir = join(buildDir, svc);
    if (!existsSync(join(dir, "tsconfig.json"))) continue;

    const localTscCmd = join(dir, "node_modules", ".bin", "tsc.cmd");
    const localTscBash = join(dir, "node_modules", ".bin", "tsc");
    const [cmd, args] = (() => {
      if (process.platform === "win32" && existsSync(localTscCmd)) {
        return [localTscCmd, ["--noEmit", "--skipLibCheck"]] as const;
      } else if (existsSync(localTscBash)) {
        return [localTscBash, ["--noEmit", "--skipLibCheck"]] as const;
      } else {
        return ["npx", ["tsc", "--noEmit", "--skipLibCheck"]] as const;
      }
    })();

    const r = spawnSync(cmd, args, {
      cwd: dir,
      encoding: "utf-8",
      timeout: 300_000,
      shell: process.platform === "win32",
    });

    if (r.error) {
      return { pass: false, reason: `${svc} TypeScript compilation could not start: ${r.error.message}` };
    }
    if (r.status !== 0) {
      const output = (r.stderr || r.stdout || "").trim().slice(0, 3000);
      return { pass: false, reason: `${svc} TypeScript compilation failed:\n${output}` };
    }
  }
  return { pass: true };
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
    import("./stages/stage5-qa-fix-loop.ts"),
    import("./stages/stage6-deployment.ts"),
  ]);

  const { appendFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");

  const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
  const logDir = join(buildDir, projectId);
  mkdirSync(logDir, { recursive: true });
  const logFilePath = join(logDir, "run.log");

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args: any[]) => {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" ");
    appendFileSync(logFilePath, `[LOG] ${msg}\n`, "utf-8");
    originalLog.apply(console, args);
  };
  console.warn = (...args: any[]) => {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" ");
    appendFileSync(logFilePath, `[WARN] ${msg}\n`, "utf-8");
    originalWarn.apply(console, args);
  };
  console.error = (...args: any[]) => {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" ");
    appendFileSync(logFilePath, `[ERROR] ${msg}\n`, "utf-8");
    originalError.apply(console, args);
  };

  try {
    await runPipelineWithStages(projectId, userInput, {
      stage1: runStage1,
      stage2: runStage2,
      stage3: runStage3,
      stage4: (pid, plan, dag) => runStage4(pid, plan as BuildPlan, dag as Dag),
      stage5: (pid, stage4Result, plan) => runQAFixLoop(pid, plan as BuildPlan, stage4Result),
      stage5_5: (pid) => runTypescriptBuildGate(pid),
      stage6: (pid, stage4Result, plan) => runStage6(pid, stage4Result, undefined, plan as BuildPlan),
    });
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;

    // Run meta-supervisor after the pipeline completes
    try {
      const { runMetaSupervisor } = await import("../meta-supervisor.ts");
      await runMetaSupervisor(projectId);
    } catch (supErr) {
      console.error(`[orchestrator] meta-supervisor execution failed: ${String(supErr)}`);
    }
  }
}
