// One-shot script: send approveSpecSignal to unblock a waiting workflow.
// Usage: bun pipeline/approve-spec.ts <projectId>
import { Client, Connection } from "@temporalio/client";

const projectId = process.argv[2];
if (!projectId) {
  console.error("Usage: bun pipeline/approve-spec.ts <projectId>");
  process.exit(1);
}

const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233" });
const client = new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? "default" });

const version = process.argv[3] ?? "v7";
const handle = client.workflow.getHandle(`project-build-${projectId}-${version}`);
await handle.signal("approveSpecSignal", true);
console.log(`[approve-spec] sent approveSpecSignal(true) → project-build-${projectId}-${version}`);
await connection.close();
