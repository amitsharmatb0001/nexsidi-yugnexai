import { db } from "@nexsidi/db";
import { projects } from "@nexsidi/db/schema";
import { eq } from "drizzle-orm";
import { Client, Connection } from "@temporalio/client";

const projectId = "rivhdw1";
const proj = await db.select().from(projects).where(eq(projects.id, projectId));
const p = proj[0];

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
  pipelineStage = `QUERY_FAILED: ${String(err).slice(0, 150)}`;
}

console.log(`STAGE=${pipelineStage} status=${p?.status ?? "NOT_FOUND"} appUrl=${p?.appUrl ?? "-"}`);
if (pendingQuestions && pendingQuestions.length > 0) {
  console.log(`  >>> PENDING QUESTIONS: ${JSON.stringify(pendingQuestions)}`);
}
process.exit(0);
