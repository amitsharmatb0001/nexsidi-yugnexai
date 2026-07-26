import { Client, Connection } from "@temporalio/client";
const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });
const handle = client.workflow.getHandle("project-build-nextech3");
await handle.signal("approveSpecSignal", true);
console.log("approveSpecSignal(true) sent to project-build-nextech3");
await conn.close();
