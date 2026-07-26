import { Client, Connection } from "@temporalio/client";
const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });
const wfId = process.argv[2] ?? "project-build-19cd08f49562-v7";
const handle = client.workflow.getHandle(wfId);
const desc = await handle.describe();
console.log("Status:", desc.status.name);
console.log("Events:", desc.historyLength);
const pd = (desc as any).pendingActivities;
if (pd?.length > 0) {
  for (const a of pd) {
    console.log("Pending:", a.activityType?.name, "att="+a.attempt);
  }
} else {
  console.log("No pending activities");
}
await conn.close();
