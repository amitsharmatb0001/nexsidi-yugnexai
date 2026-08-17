// Resumes fulfillio1 after its original workflow execution died with a
// context-chain hash mismatch (fixed in 9c8177b + 94f55ac) right after QA
// passed — spec/plan/generated-code/QA-pass all already exist on disk/DB,
// this just needs to reach Gate 2 + Stage 6. New workflowId since the
// original (project-build-fulfillio1) is now in a terminal FAILED state.
//
// 2026-08-17: "-deploy-resume" itself also closed FAILED — same
// context_chain_hash_mismatch bug, but at a THIRD layer (Temporal's own
// activity-level retry on runDeployWithLiveRetest, maximumAttempts:2 baked
// into that run's already-recorded history before this layer's fix
// (deployRetestAct, maximumAttempts:1, commit 1fa47ae) existed). That fix
// is now live on the running worker (commit f0ba2f7) but can't apply
// retroactively to a closed workflow — needs a fresh run, hence "-2".
import { Client, Connection } from "@temporalio/client";

const projectId = "fulfillio1";
const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });
const handle = await client.workflow.start("projectBuildWorkflow", {
  taskQueue: "nexsidi-pipeline",
  workflowId: `project-build-${projectId}-deploy-resume-2`,
  args: [projectId, undefined, true],
});
console.log("Resume workflow started:", handle.workflowId);
await conn.close();
