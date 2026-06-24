// Conversation session store — Redis-backed so any API instance can resume a session.
// Falls back to in-memory if Redis is unavailable (dev without Docker).

import type { ConversationState } from "./types.ts";

const TTL_SECONDS = 60 * 60 * 4; // 4 hours — active sessions only

// Lazy Redis import so the API starts even without Redis
let redis: import("ioredis").Redis | null = null;
async function getRedis(): Promise<import("ioredis").Redis | null> {
  if (redis) return redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { default: Redis } = await import("ioredis");
    redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await redis.connect();
    return redis;
  } catch {
    return null;
  }
}

const memory = new Map<string, ConversationState>(); // in-memory fallback

function key(sessionId: string): string {
  return `nexsidi:session:${sessionId}`;
}

export async function loadSession(sessionId: string): Promise<ConversationState | null> {
  const r = await getRedis();
  if (r) {
    const raw = await r.get(key(sessionId));
    return raw ? (JSON.parse(raw) as ConversationState) : null;
  }
  return memory.get(sessionId) ?? null;
}

export async function saveSession(state: ConversationState): Promise<void> {
  const r = await getRedis();
  if (r) {
    await r.setex(key(state.sessionId), TTL_SECONDS, JSON.stringify(state));
  } else {
    memory.set(state.sessionId, state);
  }
}

export function newSession(userId: string, sessionId: string): ConversationState {
  return {
    userId,
    sessionId,
    messages: [],
    phase: "gathering",
    projectId: null,
    intent: {
      projectName: null,
      description: null,
      features: [],
      confirmed: false,
    },
  };
}
