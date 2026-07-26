import { Client, Connection } from "@temporalio/client";
const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });
const wfId = "project-build-19cd08f49562-v7";
const handle = client.workflow.getHandle(wfId);
const desc = await handle.describe();
console.log(JSON.stringify({
  status: desc.status.name,
  historyLength: desc.historyLength,
  pendingActivities: (desc as any).raw?.pendingActivities ?? (desc as any).pendingActivities,
  closeTime: desc.closeTime,
  startTime: desc.startTime,
}, null, 2));
await conn.close();
