// Stage 3 — UI-only design preview + a second human approval gate.
//
// KNOWN GAP: Aanya's real `run()` (agents/generators/aanya/src/index.ts)
// takes a `BuildPlan` (apiContract, dbSchema, sharedTypes, ...) produced by
// Arjun (agents/arjun/src/index.ts, run(spec): Promise<BuildPlan>). No stage
// in this pipeline invokes Arjun yet — Stage 1 only produces a `ProjectSpec`.
// `runPipeline` in ../run.ts currently passes Stage 1's spec straight through
// as this stage's `plan` argument, since it's the only artifact available.
// That is NOT a real BuildPlan: Aanya's prompt builder reads
// `plan.apiContract.baseUrl` and `plan.sharedTypes` unconditionally, so a real
// (non-stubbed) end-to-end run of `runPipeline` will throw a TypeError here
// until an Arjun stage is wired in between Stage 1 and Stage 3. Flagged in
// the Task 10 report rather than papered over.
import { run as runAanya } from "../../../agents/generators/aanya/src/index.ts";
import type { BuildPlan } from "../../../agents/arjun/src/index.ts";
import { writeCheckpoint } from "../checkpoint.ts";
import { writeGatewayRequest, readGatewayDecision } from "../gateway.ts";

const STAGE_ID = "03-ui-preview";
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 30 * 60_000; // 30 minutes — same operational cap as Stage 2

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runStage3(
  projectId: string,
  plan: unknown
): Promise<{ locked: boolean; outputDir: string }> {
  const result = await runAanya(plan as BuildPlan, "preview");

  if (!result.success) {
    throw new Error(
      `Stage 3 UI preview build failed for project ${projectId}: ${
        result.errors.join("; ") || "unknown error"
      }`
    );
  }

  writeCheckpoint(projectId, "03-design-lock", {
    locked: true,
    outputDir: result.outputDir,
    lockedAt: new Date().toISOString(),
  });

  writeGatewayRequest(projectId, STAGE_ID, `UI preview ready for review at ${result.outputDir}`);

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const decision = await readGatewayDecision(projectId, STAGE_ID);
    if (decision !== null) {
      // Mirrors Stage 2's contract: "review" is a valid, expected outcome —
      // not an error — so we report it via `locked: false` rather than throw.
      return { locked: decision.decision === "proceed", outputDir: result.outputDir };
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Stage 3 UI preview gateway timed out after ${POLL_TIMEOUT_MS}ms waiting for a human decision (project ${projectId})`
  );
}
