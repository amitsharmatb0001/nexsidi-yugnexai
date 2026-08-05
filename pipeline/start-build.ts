// Generic one-shot build launcher — takes a projectId and a user-request
// string, starts the real unified Temporal pipeline. Used for the
// simple-site and complex-site live proof runs (2026-07-26).
import { Client, Connection } from "@temporalio/client";

const projectId = process.argv[2];
const userRequest = process.argv[3];
if (!projectId || !userRequest) {
  console.error("Usage: bun pipeline/start-build.ts <projectId> <userRequest>");
  process.exit(1);
}

const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });
const handle = await client.workflow.start("projectBuildWorkflow", {
  taskQueue: "nexsidi-pipeline",
  workflowId: `project-build-${projectId}`,
  args: [projectId, userRequest],
});
console.log("Workflow started:", handle.workflowId);
await conn.close();
