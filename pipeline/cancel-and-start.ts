import { Client, Connection } from "@temporalio/client";

const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });

try {
  await client.workflow.getHandle("project-build-test9001").terminate("Restarting fresh custom auth pipeline");
  console.log("Terminated test9001");
} catch (e) {
  console.log("test9001 already done or not found:", String(e).slice(0, 100));
}

// Start fresh
const handle = await client.workflow.start("projectBuildWorkflow", {
  taskQueue: "nexsidi-pipeline",
  workflowId: "project-build-test9001",
  args: ["test9001", "Build a task manager app: sign up, add tasks with due dates, mark tasks complete"],
});
console.log("Started:", handle.workflowId);
await conn.close();
