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

// 2026-08-30: real symptom observed live (project 6c7d4358cf73) — a NIM call
// hung for 6+ minutes with no escalation, well past NIM_TIMEOUT_MS's own
// 240s abort (nim.ts). That timeout is armed by an AbortController set up
// AFTER this function returns — so if THIS loop is what never returns, the
// timeout downstream never even gets a chance to exist, and the pipeline
// stalls with no error, no log line, nothing to retry against. I could not
// fully reproduce or prove this exact loop was tonight's specific hang
// (no live debugger attached), but the structural risk is real regardless
// and undisputed: an unbounded `while` with no iteration cap is exactly the
// same class of risk nim.ts's own header comment already documents fixing
// for the fetch call ("a hung connection stalled the whole pipeline
// indefinitely") — this loop had never received the same treatment. Capped
// generously (well above any legitimate rate-limit wait — refilling from
// empty to 1 token on the slowest configured model, mistral's shared 160
// RPM, takes well under a minute) so a real, if unusually long, rate-limit
// queue is never mistaken for a hang.
const MAX_WAIT_FOR_TOKEN_MS = 120_000;

// maxWaitMs/pollIntervalMs are overridable (default to the real production
// values) purely so this can be unit-tested in milliseconds instead of
// requiring a real 2-minute wait per test case.
export async function waitForToken(
  modelId: string,
  rpmLimit: number,
  maxWaitMs: number = MAX_WAIT_FOR_TOKEN_MS,
  pollIntervalMs = 500,
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  while (!tryAcquire(modelId, rpmLimit)) {
    if (Date.now() >= deadline) {
      throw new Error(`[llm-client] waitForToken timed out after ${maxWaitMs}ms waiting for a ${modelId} rate-limit slot — bucket state: ${JSON.stringify(getBucketState(modelId, rpmLimit))}`);
    }
    await new Promise<void>((r) => setTimeout(r, pollIntervalMs));
  }
}

// Visible for monitoring (nice-to-have #11)
export function getBucketState(modelId: string, rpmLimit: number): { tokens: number; utilizationPct: number } {
  const b = getBucket(modelId, rpmLimit);
  return { tokens: b.tokens, utilizationPct: Math.round((1 - b.tokens / rpmLimit) * 100) };
}
