// One-shot: query state and send approveSpecSignal for nextech10.
import { Client, Connection } from "@temporalio/client";

const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });
const handle = client.workflow.getHandle("project-build-nextech10");

const state = await handle.query("getPipelineState");
console.log("Current stage:", JSON.stringify(state, null, 2));

if ((state as { stage: string }).stage === "await_spec_approval") {
  await handle.signal("approveSpecSignal", true);
  console.log("approveSpecSignal(true) sent");
} else {
  console.log(`Not at await_spec_approval yet (stage=${(state as { stage: string }).stage}) — not signaling`);
}

await conn.close();
