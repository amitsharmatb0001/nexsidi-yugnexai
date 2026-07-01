import { Client, Connection } from "@temporalio/client";

const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });

const handle = await client.workflow.start("projectBuildWorkflow", {
  taskQueue: "nexsidi-pipeline",
  workflowId: "project-build-test8001",
  args: ["test8001", "Build a task manager app: sign up, add tasks with due dates, mark tasks complete"],
});
console.log("Workflow started:", handle.workflowId);
await conn.close();
