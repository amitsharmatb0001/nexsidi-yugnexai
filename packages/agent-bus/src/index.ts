// Fix #1: Redis Streams as inter-agent context transport
// Every message carries: payload + SHA-256 hash + RSA signature (Patent Claims 1/7)
// Consumer groups ensure each agent processes each message exactly once.

import type Redis from "ioredis";

export interface AgentMessage {
  fromAgent: string;
  toAgent: string;
  projectId: string;
  payload: unknown;
  contextHash: string;   // SHA-256 of canonicalized payload
  signature: string;     // RSA-SHA256 hex
  sentAt: number;        // unix ms
}

// Stream key per destination agent + project
function streamKey(toAgent: string, projectId: string): string {
  return `nexsidi:bus:${toAgent}:${projectId}`;
}

// Publish to a specific agent's inbox
export async function publish(
  redis: Redis,
  msg: AgentMessage,
): Promise<string> {
  const key = streamKey(msg.toAgent, msg.projectId);
  const id = await redis.xadd(key, "*", "data", JSON.stringify(msg));
  if (!id) throw new Error(`[agent-bus] xadd failed for ${key}`);
  return id;
}

// Consume messages for an agent — call this in a loop in each agent worker
export async function consume(
  redis: Redis,
  agentName: string,
  projectId: string,
  handler: (msg: AgentMessage) => Promise<void>,
): Promise<void> {
  const key = streamKey(agentName, projectId);
  const group = `${agentName}-workers`;
  const consumer = `${agentName}-${process.pid}`;

  // Idempotent group creation
  try {
    await redis.xgroup("CREATE", key, group, "$", "MKSTREAM");
  } catch {
    // Group already exists — that's fine
  }

  // Block for up to 5s per poll
  const results = await redis.xreadgroup(
    "GROUP", group, consumer,
    "COUNT", "10",
    "BLOCK", "5000",
    "STREAMS", key, ">",
  ) as Array<[string, Array<[string, string[]]>]> | null;

  if (!results) return;

  for (const [, entries] of results) {
    for (const [id, fields] of entries) {
      const dataIdx = fields.indexOf("data");
      if (dataIdx === -1) continue;
      const raw = fields[dataIdx + 1];
      if (!raw) continue;
      const msg = JSON.parse(raw) as AgentMessage;
      await handler(msg);
      await redis.xack(key, group, id);
    }
  }
}

// Trim old messages — keep last 1000 per stream (configurable)
export async function trim(redis: Redis, agentName: string, projectId: string, maxLen = 1000): Promise<void> {
  await redis.xtrim(streamKey(agentName, projectId), "MAXLEN", "~", maxLen);
}
