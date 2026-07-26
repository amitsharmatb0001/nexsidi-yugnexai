import { db } from './packages/db/src/client.ts';
import { agentConversations } from './packages/db/src/schema.ts';
import { desc, like } from 'drizzle-orm';

const rows = await db.select({
  id: agentConversations.id,
  agentName: agentConversations.agentName,
  projectId: agentConversations.projectId,
  createdAt: agentConversations.createdAt
}).from(agentConversations)
  .where(like(agentConversations.projectId, '%nextech5%'))
  .orderBy(desc(agentConversations.createdAt))
  .limit(5);

console.log(JSON.stringify(rows, null, 2));
process.exit(0);
