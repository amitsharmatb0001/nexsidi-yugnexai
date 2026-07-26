// P4: poll loop for the live NexTech build — prints stage/iteration/score
// state every few seconds and exits when a signal gate is reached or the
// workflow closes, so the monitoring session doesn't have to guess.
import { Client, Connection } from "@temporalio/client";

const projectId = process.argv[2] ?? "nextech1";
const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });
const handle = client.workflow.getHandle(`project-build-${projectId}`);

let lastStage = "";
for (let i = 0; i < 600; i++) {
  let desc;
  try {
    desc = await handle.describe();
  } catch (err) {
    console.log(`[poll] describe failed: ${String(err)}`);
    break;
  }
  let state: any = null;
  try {
    state = await handle.query("getPipelineState");
  } catch {
    // query may not be available before the workflow reaches setHandler
  }
  const stage = state?.stage ?? "(unknown)";
  if (stage !== lastStage || i % 6 === 0) {
    console.log(
      `[poll ${new Date().toISOString()}] status=${desc.status.name} stage=${stage} iteration=${state?.iteration ?? "-"} ` +
        `recentMinScores=${JSON.stringify(state?.recentMinScores ?? [])} stuckIterations=${state?.stuckIterations ?? "-"}`,
    );
    lastStage = stage;
  }
  if (desc.status.name !== "RUNNING") {
    console.log(`[poll] workflow closed with status ${desc.status.name}`);
    break;
  }
  if (stage === "await_spec_approval" || stage === "await_deploy_approval") {
    console.log(`[poll] GATE REACHED: ${stage} — stopping poll, needs a human/operator decision`);
    break;
  }
  await new Promise((r) => setTimeout(r, 10_000));
}
await conn.close();
