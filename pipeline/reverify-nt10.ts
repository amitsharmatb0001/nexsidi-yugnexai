// One-shot: re-run the real GAN against nextech10's ALREADY-generated files
// (no regeneration — the 3 manual fixes for the stuck-state findings are
// already on disk) and deploy if it passes. Calls the underlying stage
// functions directly rather than through the Temporal activity wrappers
// (which require Context.current(), only valid inside a real Temporal
// worker execution).
import { runQAFixLoop } from "./orchestrator/stages/stage5-qa-fix-loop.ts";
import { runStage6 } from "./orchestrator/stages/stage6-deployment.ts";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const projectId = process.argv[2] ?? "nextech10";
const buildDir = join(process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds", projectId);

const plan = JSON.parse(readFileSync(join(buildDir, "build-plan.json"), "utf-8"));

function collectFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "vendor") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full, base));
    else out.push(full.slice(base.length + 1).replaceAll("\\", "/"));
  }
  return out;
}

const stage4Result = {
  backendOutputDir: join(buildDir, "backend"),
  frontendOutputDir: join(buildDir, "frontend"),
  filesWritten: collectFiles(buildDir),
};

console.log(`[reverify] re-running the GAN against ${projectId}'s current files (${stage4Result.filesWritten.length} files)...`);
const qaResult = await runQAFixLoop(projectId, plan, stage4Result);
console.log(`[reverify] QA result: pass=${qaResult.pass} stuck=${qaResult.stuck ?? false} iterations=${qaResult.iterations} findings=${qaResult.findings.length}`);

if (!qaResult.pass) {
  console.log("[reverify] QA did not pass — not deploying. Remaining findings:");
  for (const f of qaResult.findings) console.log(`  - ${JSON.stringify(f)}`);
  process.exit(1);
}

console.log(`[reverify] QA passed — deploying...`);
const deployResult = await runStage6(projectId, stage4Result, plan);
console.log(`[reverify] Deploy result:`, JSON.stringify(deployResult, null, 2));
process.exit(deployResult.success ? 0 : 1);
