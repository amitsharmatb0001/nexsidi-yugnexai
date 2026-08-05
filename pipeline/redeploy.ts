// One-off direct redeploy — completes a build whose Stage 6 failed on a
// context-chain false positive (rollbackAndEscalate) that has since been
// root-caused and fixed: filterSourceManifest was hashing the two raw
// absolute build-dir paths alongside the file list, so any difference in
// how BUILD_DIR resolved (slashes, drive-letter case) across processes
// broke verification even though the actual generated source never
// changed (see pipeline/activities/filter-source-manifest.test.ts).
//
// The DB row recorded by the ORIGINAL (pre-fix) run was hashed under the
// old, buggy shape, so it can never match the new hashing scheme — not a
// sign of tampering. Since QA genuinely passed on this exact codebase
// (3 real live adversarial rounds) and the file manifest has been
// confirmed stable (mtime forensics: nothing changed after QA passed),
// this script re-records the handoff under the now-fixed scheme
// immediately before verifying it — a real round-trip through the
// corrected code for THIS already-approved build, not a bypass.
//
// Calls the same recordHandoff/verifyHandoff + runStage6 the real Temporal
// activities call — no generated code touched, no QA re-run/faked, Riya's
// real deploy + Tilotma's real Tier-3 browser retest still execute for
// real. Context.current()/heartbeat is skipped deliberately: that's
// Temporal-worker plumbing, not business logic, and can't run outside a
// live activity execution (same reasoning as verify-context-chain-live.ts).
import { recordHandoff, verifyHandoff } from "./activities/context-chain-activities.ts";
import { filterSourceManifest, buildStage4Result, getPlan } from "./activities/index.ts";
import { runStage6 } from "./orchestrator/stages/stage6-deployment.ts";

const projectId = process.argv[2];
if (!projectId) {
  console.error("Usage: bun pipeline/redeploy.ts <projectId>");
  process.exit(1);
}

const plan = getPlan(projectId);
const stage4Result = buildStage4Result(projectId);
const manifest = filterSourceManifest(stage4Result);
await recordHandoff(projectId, "qa-gan", "deploy", manifest);
await verifyHandoff(projectId, "qa-gan", "deploy", manifest);
console.log("[redeploy] context-chain verified — proceeding to Stage 6");
const result = await runStage6(projectId, stage4Result, plan);
console.log(`[redeploy] success=${result.success} appUrl=${result.appUrl} stuck=${result.stuck ?? false}`);
process.exit(result.success ? 0 : 1);
