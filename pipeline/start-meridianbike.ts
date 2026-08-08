import { Client, Connection } from "@temporalio/client";

const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });

const handle = await client.workflow.start("projectBuildWorkflow", {
  taskQueue: "nexsidi-pipeline",
  workflowId: "project-build-meridianbk3",
  args: [
    "meridianbk3",
    "Build a website for Meridian Bike Co, a boutique bicycle repair and " +
      "retail shop. Services: tune-ups ($45), wheel truing ($25), brake and " +
      "gear adjustment ($35), flat tire repair ($15). We also sell a small " +
      "retail catalog: helmets, bike lights, tubes, and repair tool kits. " +
      "Customers should be able to create an account and book a repair " +
      "appointment online by picking a service and a date/time. Pages: " +
      "Home, Services (with pricing), Shop, Book Appointment, Contact. " +
      "Our shop's vibe is: warm, craftsman, hands-on — think a real bike " +
      "mechanic's garage, not a generic tech startup.",
  ],
});
console.log("Workflow started:", handle.workflowId);
await conn.close();
