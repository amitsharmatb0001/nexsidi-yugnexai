import { db } from "@nexsidi/db";
import { projects, agentConversations } from "@nexsidi/db/schema";
import { eq, desc } from "drizzle-orm";
import { Client, Connection } from "@temporalio/client";

const projectId = "meridianbk3";

const proj = await db.select().from(projects).where(eq(projects.id, projectId));
const p = proj[0];

const convos = await db
  .select({ agentName: agentConversations.agentName, updatedAt: agentConversations.updatedAt, messages: agentConversations.messages })
  .from(agentConversations)
  .where(eq(agentConversations.projectId, projectId))
  .orderBy(desc(agentConversations.updatedAt))
  .limit(3);

function summarizeLastMessage(messages: unknown): string {
  if (!Array.isArray(messages) || messages.length === 0) return "(no messages)";
  const last = messages[messages.length - 1] as any;
  const role = last?.role ?? "?";
  // Try common shapes: NIM tool_calls, Gemini functionCall parts, plain text/content.
  if (Array.isArray(last?.tool_calls) && last.tool_calls.length > 0) {
    const names = last.tool_calls.map((t: any) => t?.function?.name ?? t?.name ?? "?").join(",");
    return `[${role}] tool_calls: ${names}`;
  }
  if (Array.isArray(last?.content)) {
    const fc = last.content.find((p: any) => p?.functionCall);
    if (fc) return `[${role}] functionCall: ${fc.functionCall.name}`;
    const text = last.content.find((p: any) => p?.text)?.text;
    if (text) return `[${role}] text: ${String(text).slice(0, 150)}`;
  }
  if (typeof last?.content === "string") return `[${role}] ${last.content.slice(0, 150)}`;
  return `[${role}] ${JSON.stringify(last).slice(0, 150)}`;
}

// 2026-08-09: real gap found live — polling only DB-level artifacts (project
// row, agent conversation message counts) cannot distinguish "genuinely
// idle" from "the whole Temporal workflow died" — both look identical (no
// new writes). A quota-exhaustion failure sat unnoticed for hours because of
// exactly this blind spot. Checking the workflow's own status directly closes it.
let workflowStatus = "UNKNOWN";
try {
  const res = await fetch(`http://localhost:8088/api/v1/namespaces/default/workflows/project-build-${projectId}`);
  const json = await res.json();
  workflowStatus = json?.workflowExecutionInfo?.status ?? "UNKNOWN";
} catch (err) {
  workflowStatus = `CHECK_FAILED: ${String(err).slice(0, 100)}`;
}

// 2026-08-09: real gap found live, TWICE — both meridianbk1 and meridianbk3
// sat idle for hours at the SAME approveSpecSignal human-approval gate
// (pipeline/workflows/project-build.ts's await_spec_approval), and neither
// the DB-artifact polling above nor the raw workflow RUNNING/FAILED status
// checked above surfaces THIS specific state — a workflow legitimately
// waiting on a human looks identical, from both of those vantage points, to
// one that's simply slow. The workflow exports a real queryable
// getPipelineState (state.stage) specifically for this — querying it
// directly is the one thing that actually distinguishes "waiting for you"
// from "still working," and should have been part of this script from the
// start instead of two separate multi-hour misses.
let pipelineStage = "UNKNOWN";
try {
  const conn = await Connection.connect({ address: "localhost:7233" });
  const client = new Client({ connection: conn });
  const handle = client.workflow.getHandle(`project-build-${projectId}`);
  const state = await handle.query<{ stage: string }>("getPipelineState");
  pipelineStage = state?.stage ?? "UNKNOWN";
  await conn.close();
} catch (err) {
  pipelineStage = `QUERY_FAILED: ${String(err).slice(0, 100)}`;
}

console.log(`workflow=${workflowStatus} STAGE=${pipelineStage} status=${p?.status ?? "NOT_FOUND"} appUrl=${p?.appUrl ?? "-"} iteration=${p?.iteration ?? "-"}`);
if (pipelineStage.includes("approval") || pipelineStage.includes("clarification")) {
  console.log(`  >>> WAITING ON A HUMAN — this will NOT progress until approved/answered <<<`);
}
for (const c of convos) {
  const msgCount = Array.isArray(c.messages) ? c.messages.length : 0;
  console.log(`  agent=${c.agentName} messages=${msgCount} last=${summarizeLastMessage(c.messages)}`);
}
process.exit(0);
