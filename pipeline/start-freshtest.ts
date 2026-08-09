import { Client, Connection } from "@temporalio/client";

const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });

const projectId = "freshtst1";

const handle = await client.workflow.start("projectBuildWorkflow", {
  taskQueue: "nexsidi-pipeline",
  workflowId: `project-build-${projectId}`,
  args: [
    projectId,
    "Build a website for Willow & Stone Yoga Studio. We offer classes: Vinyasa Flow, " +
      "Restorative Yoga, and Prenatal Yoga. Customers should be able to see our class " +
      "schedule and book a spot.",
  ],
});
console.log("Workflow started:", handle.workflowId);
await conn.close();
