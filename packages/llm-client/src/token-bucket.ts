// Fix #2: Per-model SHARED token bucket
// All agents using the same model (e.g. deepseek-v4-pro) drain from ONE bucket.
// A per-agent bucket would allow 3×40=120 requests — silently hitting NIM's 40 RPM.

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

const buckets = new Map<string, Bucket>();

function getBucket(modelId: string, rpmLimit: number): Bucket {
  const now = Date.now();
  const existing = buckets.get(modelId);
  if (!existing) {
    const fresh = { tokens: rpmLimit, lastRefillMs: now };
    buckets.set(modelId, fresh);
    return fresh;
  }
  // Refill proportionally to elapsed time
  const elapsedMinutes = (now - existing.lastRefillMs) / 60_000;
  existing.tokens = Math.min(rpmLimit, existing.tokens + elapsedMinutes * rpmLimit);
  existing.lastRefillMs = now;
  return existing;
}

export function tryAcquire(modelId: string, rpmLimit: number): boolean {
  const bucket = getBucket(modelId, rpmLimit);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

export async function waitForToken(modelId: string, rpmLimit: number): Promise<void> {
  while (!tryAcquire(modelId, rpmLimit)) {
    await new Promise<void>((r) => setTimeout(r, 500));
  }
}

// Visible for monitoring (nice-to-have #11)
export function getBucketState(modelId: string, rpmLimit: number): { tokens: number; utilizationPct: number } {
  const b = getBucket(modelId, rpmLimit);
  return { tokens: b.tokens, utilizationPct: Math.round((1 - b.tokens / rpmLimit) * 100) };
}
