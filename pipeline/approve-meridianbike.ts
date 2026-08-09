import { Client, Connection } from "@temporalio/client";

const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });

const handle = client.workflow.getHandle("project-build-meridianbk4");
await handle.signal("approveSpecSignal", true);
console.log("Sent approveSpecSignal(true) to project-build-meridianbk4");
await conn.close();
