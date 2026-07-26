import { Client, Connection } from "@temporalio/client";
const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });

// List open workflows
const result = client.workflow.list({ query: "ExecutionStatus = 'Running'" });
const workflows = [];
for await (const wf of result) {
  workflows.push({ id: wf.workflowId, runId: wf.runId, startTime: wf.startTime, status: wf.status });
}
console.log(JSON.stringify(workflows, null, 2));
await conn.close();
process.exit(0);
