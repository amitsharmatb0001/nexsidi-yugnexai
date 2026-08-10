import { db } from "@nexsidi/db";
import { agentConversations } from "@nexsidi/db/schema";
import { eq } from "drizzle-orm";

const rows = await db
  .select({ id: agentConversations.id, agentName: agentConversations.agentName, updatedAt: agentConversations.updatedAt })
  .from(agentConversations)
  .where(eq(agentConversations.projectId, "freshtst1"));
console.log(JSON.stringify(rows, null, 2));
