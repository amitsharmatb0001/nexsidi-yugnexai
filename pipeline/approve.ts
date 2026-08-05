// Generic one-shot approval signal sender — approves or rejects the spec
// gate (which now includes the design brief — see PipelineState.designBrief
// in pipeline/workflows/project-build.ts) or the deploy gate.
import { Client, Connection } from "@temporalio/client";

const projectId = process.argv[2];
const gate = process.argv[3]; // "spec" | "deploy"
// 2026-08-05: previously always sent `true` — approveSpecSignal(false) was
// a real, working signal, but nothing in this script could ever send it, and
// (until the workflow fix alongside this) it did nothing anyway. Defaulting
// to "approve" keeps every existing call site (`bun pipeline/approve.ts <id>
// spec`) working unchanged; passing "reject" is new.
const decisionArg = (process.argv[4] ?? "approve").toLowerCase();
if (!projectId || (gate !== "spec" && gate !== "deploy") || (decisionArg !== "approve" && decisionArg !== "reject")) {
  console.error("Usage: bun pipeline/approve.ts <projectId> <spec|deploy> [approve|reject]");
  process.exit(1);
}
const approved = decisionArg === "approve";

const signalName = gate === "spec" ? "approveSpecSignal" : "approveDeploySignal";
const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });
const handle = client.workflow.getHandle(`project-build-${projectId}`);
await handle.signal(signalName, approved);
console.log(`${signalName}(${approved}) sent to project-build-${projectId}`);
if (!approved && gate === "spec") {
  console.log(`The workflow will ask what to change — check with: bun pipeline/answer-clarification.ts ${projectId}`);
}
await conn.close();
