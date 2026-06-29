import { Client, Connection } from "@temporalio/client";

const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });

// Cancel the stuck workflow
try {
  await client.workflow.getHandle("project-build-test8001").terminate("Restarting with all fixes: ===FILE=== format + 8192 tokens + 5 attempts");
  console.log("Terminated test8001");
} catch (e) {
  console.log("test8001 already done or not found:", String(e).slice(0, 100));
}

// Start fresh
const handle = await client.workflow.start("projectBuildWorkflow", {
  taskQueue: "nexsidi-pipeline",
  workflowId: "project-build-test9001",
  args: ["test9001", "Build a task manager app: sign up, add tasks with due dates, mark tasks complete"],
});
console.log("Started:", handle.workflowId);
await conn.close();
