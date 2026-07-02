// Stage 3 — UI-only design preview + a second human approval gate.
//
// Aanya's real `run()` (agents/generators/aanya/src/index.ts) takes a
// `BuildPlan` (apiContract, dbSchema, sharedTypes, ...) produced by Arjun
// (agents/arjun/src/index.ts, run(spec): Promise<BuildPlan>). Stage 1 now
// calls Arjun and returns the real `BuildPlan` alongside the `ProjectSpec`
// (see stage1-requirements.ts); `runPipelineWithStages` in ../run.ts passes
// that `plan` — not the raw spec — as this stage's `plan` argument, so the
// `plan as BuildPlan` cast below reflects the real runtime shape. The `plan`
// parameter here is still typed `unknown` because this function is invoked
// through the injectable `PipelineStages` interface, which stays untyped on
// purpose to keep run.test.ts's stubs decoupled from agent internals.
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

  // Same checkpoint key run.ts's runPipelineWithStages later writes for this
  // stage's final result ("03-ui-preview") — a prior version of this file
  // used a separate "03-design-lock" key here, which meant the same stage
  // wrote two different checkpoint files (final-whole-branch-review.md F4).
  // Writing this interim record (before the human decision is known, so a
  // crash during the up-to-30-minute poll below doesn't lose the fact that
  // Aanya's preview build already succeeded) under the SAME key run.ts uses
  // means run.ts's post-stage3 write simply supersedes it once the decision
  // resolves — one key, one file, per stage.
  writeCheckpoint(projectId, "03-ui-preview", {
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
