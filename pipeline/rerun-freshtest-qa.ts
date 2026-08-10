import { readFileSync } from "node:fs";
import { runQAFixLoop } from "./orchestrator/stages/stage5-qa-fix-loop.ts";
import type { BuildPlan } from "../agents/arjun/src/index.ts";
import type { Stage4Result } from "./orchestrator/stages/stage4-multi-agent-dev.ts";

const projectId = "freshtst1";
const plan: BuildPlan = JSON.parse(readFileSync(`E:/tmp/nexsidi-builds/${projectId}/build-plan.json`, "utf-8"));

const stage4Result: Stage4Result = {
  backendOutputDir: `E:/tmp/nexsidi-builds/${projectId}/backend`,
  frontendOutputDir: `E:/tmp/nexsidi-builds/${projectId}/frontend`,
  filesWritten: [],
};

console.log("[rerun] re-invoking Stage 5 QA fix loop directly against the fixed freshtst1 build...");
const result = await runQAFixLoop(projectId, plan, stage4Result);
console.log(`[rerun] result: pass=${result.pass} stuck=${result.stuck} iterations=${result.iterations} findings=${result.findings.length}`);
if (result.findings.length > 0) {
  console.log(`[rerun] remaining findings: ${JSON.stringify(result.findings, null, 2)}`);
}
