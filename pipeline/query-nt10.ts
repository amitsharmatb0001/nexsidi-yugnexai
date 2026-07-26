import { Client, Connection } from "@temporalio/client";
const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });
const handle = client.workflow.getHandle("project-build-nextech10");
const state = await handle.query("getPipelineState");
console.log("Current state:", JSON.stringify(state, null, 2));
await conn.close();
