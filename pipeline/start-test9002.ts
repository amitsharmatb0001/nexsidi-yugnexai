import { Client, Connection } from "@temporalio/client";

const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });

const handle = await client.workflow.start("projectBuildWorkflow", {
  taskQueue: "nexsidi-pipeline",
  workflowId: "project-build-test9002",
  args: ["test9002", "Build me a task manager — sign up, add tasks with due dates, check them off"],
});
console.log("Workflow started:", handle.workflowId);
await conn.close();
