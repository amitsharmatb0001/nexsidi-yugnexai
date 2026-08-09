import { readFileSync } from "node:fs";
import { runStage6 } from "./orchestrator/stages/stage6-deployment.ts";
import type { BuildPlan } from "../agents/arjun/src/index.ts";
import type { Stage4Result } from "./orchestrator/stages/stage4-multi-agent-dev.ts";

const plan: BuildPlan = JSON.parse(
  readFileSync("E:/tmp/nexsidi-builds/meridianbk4/build-plan.json", "utf-8"),
);

const stage4Result: Stage4Result = {
  backendOutputDir: "E:/tmp/nexsidi-builds/meridianbk4/backend",
  frontendOutputDir: "E:/tmp/nexsidi-builds/meridianbk4/frontend",
  filesWritten: [],
};

console.log("[redeploy] invoking Stage 6 (Riya deploy + live retest) directly against the fixed meridianbk4 build...");
const result = await runStage6("meridianbk4", stage4Result, plan);
console.log(`[redeploy] result: success=${result.success} appUrl=${result.appUrl ?? "-"} stuck=${result.stuck ?? false}`);
console.log(`[redeploy] deliverySummary: ${JSON.stringify(result.deliverySummary, null, 2)}`);
if (result.findings) {
  console.log(`[redeploy] findings: ${JSON.stringify(result.findings, null, 2)}`);
}
