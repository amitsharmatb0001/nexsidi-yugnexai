import { Client, Connection } from "@temporalio/client";

const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });

const projectId = "rivhdw1";

const handle = await client.workflow.start("projectBuildWorkflow", {
  taskQueue: "nexsidi-pipeline",
  workflowId: `project-build-${projectId}`,
  args: [
    projectId,
    "Build an online catalog and ordering site for Riverside Hardware Co., a local " +
      "hardware and home-improvement store. We sell products across several categories " +
      "(tools, paint, plumbing, electrical, garden). Customers should be able to browse " +
      "products, view details and stock levels, place orders, and see their own order " +
      "history. We (the store) need to manage our own product catalog ourselves after " +
      "launch — add new products, update prices and stock, remove discontinued items — " +
      "and we need to see and update the status of incoming orders (received, packed, " +
      "ready for pickup) ourselves too. Customers should also be able to leave a review " +
      "on products they've ordered.",
  ],
});
console.log("Workflow started:", handle.workflowId);
await conn.close();
