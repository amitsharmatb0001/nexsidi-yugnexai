import { Client, Connection } from "@temporalio/client";
import { readFileSync } from "fs";

const projectId = process.argv[2] ?? "7e1ab88dc56a";

// Read the user request from the build dir
const buildDir = "C:/tmp/nexsidi-builds";
let userRequest: string;
try {
  userRequest = readFileSync(`${buildDir}/${projectId}/user-request.txt`, "utf-8");
} catch {
  userRequest = "Build the NexTech company website";
}

const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });

// Start a fresh workflow - the new worker has checkBuildPlanExists so it will
// detect build-plan.json and skip the spec/decompose gate.
const handle = await client.workflow.start("projectBuildWorkflow", {
  taskQueue: "nexsidi-pipeline",
  workflowId: `project-build-${projectId}-v7`,
  args: [projectId, userRequest],
});

console.log(`[restart] started workflow ${handle.workflowId} for project ${projectId}`);
await conn.close();
