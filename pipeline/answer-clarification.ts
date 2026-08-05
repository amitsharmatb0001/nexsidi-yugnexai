// Reusable CLI for NexSidi's clarification pause (see pipeline/workflows/
// project-build.ts's askAndWait / answerClarificationSignal). Mirrors
// approve.ts's pattern.
//
// Usage:
//   bun pipeline/answer-clarification.ts <projectId>              — print the pending question(s)
//   bun pipeline/answer-clarification.ts <projectId> "<answer>"   — answer and resume the workflow
import { Client, Connection } from "@temporalio/client";
import { getPipelineState, answerClarificationSignal } from "./workflows/project-build.ts";

const projectId = process.argv[2];
const answer = process.argv[3];
if (!projectId) {
  console.error('Usage: bun pipeline/answer-clarification.ts <projectId> ["<answer>"]');
  process.exit(1);
}

const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });
const handle = client.workflow.getHandle(`project-build-${projectId}`);

if (!answer) {
  const state = await handle.query(getPipelineState);
  console.log(`Stage: ${state.stage}`);

  // 2026-08-05: the design brief was previously invisible everywhere —
  // showing it here whenever it's set (not just at the approval gate) gives
  // a way to actually SEE what's about to be approved, not just approve
  // blind. See PipelineState.designBrief's header comment.
  if (state.designBrief) {
    const b = state.designBrief;
    console.log(`\nDesign brief:`);
    console.log(`  Mood: ${b.mood}`);
    console.log(`  Palette: ${b.palette.map((c) => `${c.name} (${c.hex})`).join(", ")}`);
    console.log(`  Typography: display=${b.typography.display}, body=${b.typography.body}`);
    console.log(`  Layout: ${b.layoutConcept}`);
  }

  if (!state.pendingQuestions || state.pendingQuestions.length === 0) {
    console.log(`\nNo pending question for ${projectId}.`);
    if (state.stage === "await_spec_approval") {
      console.log(`Approve with: bun pipeline/approve.ts ${projectId} spec approve`);
      console.log(`Reject with:  bun pipeline/approve.ts ${projectId} spec reject`);
    }
  } else {
    console.log(`\nPending question(s) for ${projectId}:`);
    state.pendingQuestions.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
    console.log(`\nAnswer with: bun pipeline/answer-clarification.ts ${projectId} "<your answer>"`);
  }
} else {
  await handle.signal(answerClarificationSignal, answer);
  console.log(`answerClarificationSignal sent to project-build-${projectId}`);
}

await conn.close();
