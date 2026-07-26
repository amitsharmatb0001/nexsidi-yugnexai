import { Client, Connection } from "@temporalio/client";
const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });
const handle = client.workflow.getHandle(process.argv[2] ?? "project-build-nextech2");
try {
  await handle.result();
} catch (err: any) {
  console.log("WORKFLOW ERROR:");
  console.log(err?.message);
  console.log(JSON.stringify(err?.cause ?? err, Object.getOwnPropertyNames(err?.cause ?? err ?? {}), 2));
}
await conn.close();
