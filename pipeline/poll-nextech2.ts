// P4: poll loop for the live NexTech build, phase 2 (post spec-approval) —
// prints stage/iteration/score state every ~15s and exits when the deploy
// gate is reached or the workflow closes.
import { Client, Connection } from "@temporalio/client";

const projectId = process.argv[2] ?? "nextech2";
const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });
const handle = client.workflow.getHandle(`project-build-${projectId}`);

let lastStage = "";
for (let i = 0; i < 400; i++) {
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
  } catch {}
  const stage = state?.stage ?? "(unknown)";
  if (stage !== lastStage || i % 4 === 0) {
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
  if (stage === "await_deploy_approval") {
    console.log(`[poll] GATE REACHED: ${stage} — stopping poll, needs a human/operator decision`);
    break;
  }
  if (stage === "error") {
    console.log(`[poll] STAGE=ERROR — stopping poll`);
    break;
  }
  await new Promise((r) => setTimeout(r, 15_000));
}
await conn.close();
