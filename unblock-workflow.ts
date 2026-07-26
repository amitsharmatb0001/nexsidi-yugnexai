import { Client, Connection } from "@temporalio/client";

const workflowId = process.argv[2] ?? "project-build-7e1ab88dc56a";

const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });
const handle = client.workflow.getHandle(workflowId);
await handle.signal("approveSpecSignal", true);
console.log(`[unblock] sent approveSpecSignal(true) to ${workflowId}`);
await conn.close();
