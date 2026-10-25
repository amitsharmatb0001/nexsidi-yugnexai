// Temporary watcher for one build (delete after use): prints a line when the stage, running activities or workflow status
// change, and exits when the workflow ends. Usage: bun pipeline/.watch.tmp.ts <projectId>
import { Connection, Client } from "@temporalio/client";

const projectId = process.argv[2]!;
const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233" });
const client = new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? "default" });
const handle = client.workflow.getHandle(`project-build-${projectId}`);
const t0 = Date.now();
let prev = "";
for (;;) {
  let line: string;
  let ended = false;
  try {
    const d = await handle.describe();
    const running = (d.raw.pendingActivities ?? []).map((a) => a.activityType?.name).filter(Boolean).sort().join(",") || "-";
    let stage = "?";
    try {
      const s = (await handle.query("getPipelineState")) as { stage?: string };
      stage = s?.stage ?? "?";
    } catch { /* query unavailable when closed */ }
    ended = d.status.name !== "RUNNING";
    line = `${d.status.name} | stage=${stage} | running: ${running}`;
  } catch (e) {
    line = `watch error: ${String(e).slice(0, 120)}`;
  }
  if (line !== prev) {
    console.log(`[${Math.round((Date.now() - t0) / 60000)} min] ${line}`);
    prev = line;
  }
  if (ended) process.exit(0);
  await new Promise((r) => setTimeout(r, 15000));
}
