import { Client, Connection } from "@temporalio/client";

const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });

const handle = client.workflow.getHandle("project-build-rivhdw1");
await handle.signal("retryStageSignal", true);
console.log("Sent retryStageSignal(true) to project-build-rivhdw1");
await conn.close();
