import { db } from "@nexsidi/db";
import { projects, agentConversations } from "@nexsidi/db/schema";
import { eq, desc } from "drizzle-orm";
import { Client, Connection } from "@temporalio/client";

const projectId = "freshtst1";

const proj = await db.select().from(projects).where(eq(projects.id, projectId));
const p = proj[0];

const convos = await db
  .select({ agentName: agentConversations.agentName, updatedAt: agentConversations.updatedAt, messages: agentConversations.messages })
  .from(agentConversations)
  .where(eq(agentConversations.projectId, projectId))
  .orderBy(desc(agentConversations.updatedAt))
  .limit(3);

let workflowStatus = "UNKNOWN";
try {
  const res = await fetch(`http://localhost:8088/api/v1/namespaces/default/workflows/project-build-${projectId}`);
  const json = await res.json();
  workflowStatus = json?.workflowExecutionInfo?.status ?? "UNKNOWN";
} catch (err) {
  workflowStatus = `CHECK_FAILED: ${String(err).slice(0, 100)}`;
}

let pipelineStage = "UNKNOWN";
let pendingQuestions: string[] | null = null;
try {
  const conn = await Connection.connect({ address: "localhost:7233" });
  const client = new Client({ connection: conn });
  const handle = client.workflow.getHandle(`project-build-${projectId}`);
  const state = await handle.query<{ stage: string; pendingQuestions?: string[] | null }>("getPipelineState");
  pipelineStage = state?.stage ?? "UNKNOWN";
  pendingQuestions = state?.pendingQuestions ?? null;
  await conn.close();
} catch (err) {
  pipelineStage = `QUERY_FAILED: ${String(err).slice(0, 100)}`;
}

console.log(`workflow=${workflowStatus} STAGE=${pipelineStage} status=${p?.status ?? "NOT_FOUND"} appUrl=${p?.appUrl ?? "-"}`);
if (pendingQuestions && pendingQuestions.length > 0) {
  console.log(`  >>> PENDING QUESTIONS: ${JSON.stringify(pendingQuestions)}`);
}
if (pipelineStage.includes("approval") || pipelineStage.includes("clarification")) {
  console.log(`  >>> WAITING ON A HUMAN — this will NOT progress until approved/answered <<<`);
}
for (const c of convos) {
  const msgCount = Array.isArray(c.messages) ? c.messages.length : 0;
  console.log(`  agent=${c.agentName} messages=${msgCount}`);
}
process.exit(0);
