// Planner session store — Redis-backed so any API instance can resume a session.
// Falls back to in-memory if Redis is unavailable (dev without Docker).

import type { PlannerState } from "./types.ts";

const TTL_SECONDS = 60 * 60 * 4; // 4 hours

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

const memory = new Map<string, PlannerState>();

function key(sessionId: string): string {
  return `nexsidi:planner:${sessionId}`;
}

export async function loadSession(sessionId: string): Promise<PlannerState | null> {
  const r = await getRedis();
  if (r) {
    const raw = await r.get(key(sessionId));
    return raw ? (JSON.parse(raw) as PlannerState) : null;
  }
  return memory.get(sessionId) ?? null;
}

export async function saveSession(state: PlannerState): Promise<void> {
  const r = await getRedis();
  if (r) {
    await r.setex(key(state.sessionId), TTL_SECONDS, JSON.stringify(state));
  } else {
    memory.set(state.sessionId, state);
  }
}

export function newSession(userId: string, sessionId: string): PlannerState {
  return {
    userId,
    sessionId,
    messages:     [],
    phase:        "planning",
    projectId:    null,
    buildPlan:    null,
    proposedPlan: null,
  };
}
