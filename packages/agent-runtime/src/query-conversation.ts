import { db, agentConversations } from "@nexsidi/db";
import { eq } from "drizzle-orm";

async function run() {
  const projectId = "51a0f230ecc2";
  const convs = await db
    .select()
    .from(agentConversations)
    .where(eq(agentConversations.projectId, projectId));

  console.log(`Found ${convs.length} conversations for project ${projectId}`);
  for (const c of convs) {
    console.log(`\n==================================================`);
    console.log(`Agent Name: ${c.agentName}`);
    console.log(`Number of messages: ${c.messages.length}`);
    const messages = c.messages as any[];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      console.log(`\n--- Message ${i + 1} (${msg.role}) ---`);
      if (msg.content) {
        const contentStr = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        console.log(contentStr.slice(0, 1000) + (contentStr.length > 1000 ? "..." : ""));
      }
      if (msg.tool_calls) {
        console.log("Tool Calls:", JSON.stringify(msg.tool_calls, null, 2));
      }
    }
  }
}

run().catch(console.error);
