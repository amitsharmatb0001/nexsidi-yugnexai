import { readFileSync } from "node:fs";
import { runStage6 } from "./orchestrator/stages/stage6-deployment.ts";
import type { BuildPlan } from "../agents/arjun/src/index.ts";
import type { Stage4Result } from "./orchestrator/stages/stage4-multi-agent-dev.ts";

const projectId = "freshtst1";
const plan: BuildPlan = JSON.parse(readFileSync(`E:/tmp/nexsidi-builds/${projectId}/build-plan.json`, "utf-8"));

const stage4Result: Stage4Result = {
  backendOutputDir: `E:/tmp/nexsidi-builds/${projectId}/backend`,
  frontendOutputDir: `E:/tmp/nexsidi-builds/${projectId}/frontend`,
  filesWritten: [],
};

console.log("[deploy] re-invoking Stage 6 (deploy + Tier 3 live retest) directly against the fixed freshtst1 build...");
const result = await runStage6(projectId, stage4Result, plan);
console.log(`[deploy] result: success=${result.success} appUrl=${result.appUrl}`);
if (result.findings) {
  console.log(`[deploy] findings: ${JSON.stringify(result.findings, null, 2)}`);
}
console.log(`[deploy] deliverySummary: ${JSON.stringify(result.deliverySummary, null, 2)}`);
