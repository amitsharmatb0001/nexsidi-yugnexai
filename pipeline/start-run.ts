import { Client, Connection } from "@temporalio/client";

const projectId = "verify" + Date.now().toString().slice(-6);

const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });

const handle = await client.workflow.start("projectBuildWorkflow", {
  taskQueue: "nexsidi-pipeline",
  workflowId: `project-build-${projectId}`,
  args: [
    projectId,
    "Build a professional company website for NexTech — we provide mobile app " +
      "development, web app development, custom software, CRM, POS, bulk SMS, email " +
      "marketing, domain & hosting, and digital marketing services. Company name: NexTech. " +
      "Pages needed: Home, About Us, Vision, Mission, Services, Products, Contact. " +
      "Our vision is to make India a digital economy. Include a contact form and sign in/out.",
  ],
});
console.log("Workflow started:", handle.workflowId, "projectId:", projectId);
await conn.close();
