// Fresh investor-demo build (project #1 of 2 approved) — B2B inventory
// & fulfillment SaaS for small logistics businesses. One-shot launcher,
// same pattern as start-nextech.ts.
import { Client, Connection } from "@temporalio/client";

const projectId = process.argv[2] ?? "fulfillio1";
const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });
const handle = await client.workflow.start("projectBuildWorkflow", {
  taskQueue: "nexsidi-pipeline",
  workflowId: `project-build-${projectId}`,
  args: [
    projectId,
    "Build Fulfillio — a B2B inventory and order-fulfillment platform for " +
      "small logistics and warehousing businesses. Two account roles: Owner " +
      "(runs the warehouse business, manages inventory, staff, and fulfillment) " +
      "and Staff (picks and fulfills orders, updates stock counts, cannot see " +
      "billing). Core features: multi-location inventory tracking (items, SKUs, " +
      "quantity per warehouse location, low-stock threshold alerts), order " +
      "management (incoming orders, fulfillment status pipeline: pending -> " +
      "picking -> packed -> shipped -> delivered), a staff directory with " +
      "role-based permissions, and a billing/subscription page showing the " +
      "account's current plan and usage (mock payment, no real charges). " +
      "Pages needed: landing/marketing page explaining the product, sign in/up, " +
      "dashboard (key metrics: open orders, low-stock items, fulfillment rate), " +
      "inventory (list + detail view per item, add/edit stock), orders (list + " +
      "detail view, status updates), staff management, billing/plan page, " +
      "account settings. This should feel like real, unglamorous enterprise " +
      "software — dense data tables, clear status indicators, not a consumer app.",
  ],
});
console.log("Workflow started:", handle.workflowId);
await conn.close();
