import { Client, Connection } from "@temporalio/client";
const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });

const wfIds = [
  "project-build-nextech6",
  "project-build-nextech1",
  "project-build-nextech5",
  "project-build-19cd08f49562-v7"
];

for (const wfId of wfIds) {
  try {
    const h = client.workflow.getHandle(wfId);
    const d = await h.describe();
    console.log(wfId, "=>", d.status.name, "histLen:", d.historyLength);
  } catch (e: any) {
    console.log(wfId, "=> NOT_FOUND");
  }
}
await conn.close();
process.exit(0);
