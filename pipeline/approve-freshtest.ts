import { Client, Connection } from "@temporalio/client";

const which = process.argv[2] ?? "spec"; // "spec" or "deploy"
const signalName = which === "deploy" ? "approveDeploySignal" : "approveSpecSignal";

const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });

const handle = client.workflow.getHandle("project-build-freshtst1");
await handle.signal(signalName, true);
console.log(`Sent ${signalName}(true) to project-build-freshtst1`);
await conn.close();
