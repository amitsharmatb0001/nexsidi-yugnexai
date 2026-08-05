// Resume the fix loop against an EXISTING build directory — bypasses
// generation entirely. Used to test whether the improved agents can now
// converge on findings the pipeline previously got stuck on.
import { runQAFixLoop } from "./orchestrator/stages/stage5-qa-fix-loop.ts";
import { getPlan, buildStage4Result } from "./activities/index.ts";

const projectId = process.argv[2];
if (!projectId) {
  console.error("Usage: bun pipeline/retest-fixloop.ts <projectId>");
  process.exit(1);
}

const plan = getPlan(projectId);
const stage4Result = buildStage4Result(projectId);
const result = await runQAFixLoop(projectId, plan, stage4Result);
console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
