import { Client, Connection } from "@temporalio/client";

const answer = process.argv[2];
if (!answer) {
  console.error("Usage: bun pipeline/answer-freshtest.ts \"<answer text>\"");
  process.exit(1);
}

const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });

const handle = client.workflow.getHandle("project-build-freshtst1");
await handle.signal("answerClarificationSignal", answer);
console.log(`Sent answerClarificationSignal("${answer}") to project-build-freshtst1`);
await conn.close();
