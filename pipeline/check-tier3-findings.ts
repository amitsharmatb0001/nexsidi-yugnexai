import { db } from "@nexsidi/db";
import { agentConversations } from "@nexsidi/db/schema";
import { eq, and } from "drizzle-orm";

const rows = await db
  .select()
  .from(agentConversations)
  .where(and(eq(agentConversations.projectId, "meridianbk4"), eq(agentConversations.agentName, "tilotma-evidence-collector")));

const msgs = rows[0]?.messages as any[];
const last = msgs[msgs.length - 1];
console.log(JSON.stringify(last, null, 2));
