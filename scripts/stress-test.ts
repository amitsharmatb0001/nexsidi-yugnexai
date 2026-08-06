// Stress-test driver — design doc's mandatory incremental self-verification
// (docs/superpowers/specs/2026-07-01-full-agentic-pipeline-design.md, F7 in
// .nexsidi/sdd/progress.md). Drives the real `runPipeline()` entry point
// (pipeline/orchestrator/run.ts) directly — NOT via the API/Temporal layer,
// because apps/api/src/routes/pipeline.ts still starts the older
// pipeline/workflows/project-build.ts workflow (a separate, pre-existing
// system, not yet replaced — see final-whole-branch-review-v2.md F7 and the
// progress ledger). runPipeline() is the actual deliverable of Tasks 1-15;
// this script is the "external human/UI" that gateway.ts's own doc comments
// say is responsible for writing decision.json files — Stage 2 and Stage 3
// each pause and poll for one.
//
// Usage: bun run scripts/stress-test.ts <projectId> "<user request>"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runPipeline } from "../pipeline/orchestrator/run.ts";
import { readCheckpoint } from "../pipeline/orchestrator/checkpoint.ts";

const projectId = process.argv[2];
const userInput = process.argv[3];

if (!projectId || !userInput) {
  console.error('Usage: bun run scripts/stress-test.ts <projectId> "<user request>"');
  process.exit(1);
}

const BUILD_DIR = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";
const GATE_STAGES = ["02-gateway", "03-ui-preview"];
const AUTO_APPROVE_POLL_MS = 3_000;

function decisionPath(stage: string): string {
  return join(BUILD_DIR, projectId, "gateway", `${stage}.decision.json`);
}

function requestPath(stage: string): string {
  return join(BUILD_DIR, projectId, "gateway", `${stage}.request.json`);
}

// Mirrors the atomic-write convention gateway.ts's own doc comment asks
// external decision-writers to follow (temp file + rename).
function autoApprove(stage: string): void {
  const path = decisionPath(stage);
  const dir = join(BUILD_DIR, projectId, "gateway");
  mkdirSync(dir, { recursive: true });
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, JSON.stringify({ decision: "proceed" }, null, 2), "utf-8");
  renameSync(tmpPath, path);
  console.log(`[stress-test] auto-approved gate: ${stage}`);
}

// Poll for gateway *request* files and auto-approve each stage exactly once,
// simulating a human always clicking "Proceed" — this stress test is
// verifying the pipeline's own logic/wiring, not exercising the approval
// gate's reject path (that path already has direct unit coverage in
// stage2-gateway.test.ts / stage3-ui-preview.test.ts).
let stopPolling = false;
async function gateAutoApprover(): Promise<void> {
  const approved = new Set<string>();
  while (!stopPolling) {
    for (const stage of GATE_STAGES) {
      if (approved.has(stage)) continue;
      if (existsSync(requestPath(stage)) && !existsSync(decisionPath(stage))) {
        autoApprove(stage);
        approved.add(stage);
      }
    }
    await new Promise((r) => setTimeout(r, AUTO_APPROVE_POLL_MS));
  }
}

async function main(): Promise<void> {
  console.log(`[stress-test] project=${projectId}`);
  console.log(`[stress-test] request=${JSON.stringify(userInput)}`);
  console.log(`[stress-test] BUILD_DIR=${BUILD_DIR}`);

  const start = Date.now();
  const approverPromise = gateAutoApprover();

  let error: unknown = null;
  try {
    await runPipeline(projectId, userInput);
  } catch (err) {
    error = err;
  } finally {
    stopPolling = true;
    await approverPromise;
  }

  const elapsedMs = Date.now() - start;
  console.log(`\n[stress-test] ===== RESULT =====`);
  console.log(`[stress-test] elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);

  if (error) {
    console.log(`[stress-test] STATUS: THREW`);
    console.error(error);
  } else {
    console.log(`[stress-test] STATUS: returned normally (check checkpoints for actual pass/fail)`);
  }

  for (const stage of [
    "01-requirements",
    "02-gateway",
    "03-ui-preview",
    "04-dev",
    "05-qa",
    "06-deployment",
  ]) {
    const data = readCheckpoint(projectId, stage);
    console.log(`\n[stress-test] --- checkpoint: ${stage} ---`);
    console.log(data === null ? "(not reached)" : JSON.stringify(data, null, 2).slice(0, 3000));
  }

  process.exit(error ? 1 : 0);
}

main();
