// Shared quota-exhaustion retry wrapper for generator calls (initial
// generation AND fix-loop repairs). Extracted from pipeline/activities/
// index.ts into its own module — index.ts imports stage5-qa-fix-loop.ts
// (for runQAFixLoop), and stage5-qa-fix-loop.ts needs this same retry
// wrapper for its own generator calls; importing it back from index.ts
// would create a circular dependency between the two files. A small,
// dependency-free module both can import from avoids that entirely.
import { isQuotaExhaustionError } from "../../packages/agent-runtime/src/gemini-loop.ts";

const GENERATOR_QUOTA_RETRY_BACKOFF_MS = 90_000;
const MAX_GENERATOR_QUOTA_RETRIES = 2;

// 2026-08-07: explicit user request, live (project bae438767bed) — Tier 3's
// evidence-collector/reality-checker and System B's live-eval had NO quota
// retry at all (unlike deploy/generator, which already had the 90s×2 pattern
// above). Confirmed live: a single 429 mid-run aborted the whole stage with
// zero recovery attempt, forcing a manual re-run of the entire pipeline
// script — repeated 8 times in one session. The 90s×2 pattern above is
// tuned for a brief circuit-breaker blip; it's the wrong tool for a genuine
// multi-minute Vertex quota window (confirmed live: outlasted 90s×2 twice).
// This is a SEPARATE, longer-horizon mechanism: instead of blindly retrying
// on a fixed short clock, poll a cheap real health-check on a 5-minute clock
// (user's explicit interval) and only resume the real (expensive) operation
// once the health check confirms models are actually responding again —
// "wait & retry, or a separate thing that watches every 5 min ... when
// they're back so the app can pick up where it was" (user's own words).
// Bounded at maxPolls (default 24 × 5min = ~2h) rather than infinite — a
// permanently broken credential/billing state should surface as a real
// failure eventually, not hang the pipeline forever.
const QUOTA_WATCH_POLL_INTERVAL_MS = 5 * 60_000;
const QUOTA_WATCH_MAX_POLLS = 24;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Minimal, cheap real call used to confirm Gemini/Vertex is actually serving
// requests again before resuming the real (expensive, multi-turn) operation.
// fastFailOn429 means a still-exhausted endpoint reports unhealthy in one
// request instead of paying fetchGeminiWithRetry's local backoff first.
async function checkGeminiHealth(): Promise<boolean> {
  try {
    const { geminiChat } = await import("@nexsidi/llm-client");
    await geminiChat([{ role: "user", content: "ping" }], { maxTokens: 5, fastFailOn429: true });
    return true;
  } catch {
    return false;
  }
}

export interface QuotaWatchOptions {
  pollIntervalMs?: number;
  maxPolls?: number;
  healthCheckFn?: () => Promise<boolean>;
  sleepFn?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

// Runs `attempt` once. On a quota-exhaustion-shaped failure, enters a
// watch loop: sleep pollIntervalMs, run a cheap health check, and only
// re-invoke `attempt` (the real, expensive operation) once the health check
// confirms recovery — "picking up where it left off" by simply re-running
// the same operation, which every caller of this function (Tier 3's stages,
// live-eval) is already safe to re-run from scratch. Any non-quota failure
// returns immediately, unchanged — a genuine bug still fails fast, exactly
// like runGeneratorWithQuotaRetry above.
export async function runWithQuotaWatchAndResume<T extends { success: boolean; errors: string[] }>(
  attempt: () => Promise<T>,
  opts: QuotaWatchOptions = {},
): Promise<T> {
  const pollIntervalMs = opts.pollIntervalMs ?? QUOTA_WATCH_POLL_INTERVAL_MS;
  const maxPolls = opts.maxPolls ?? QUOTA_WATCH_MAX_POLLS;
  const healthCheckFn = opts.healthCheckFn ?? checkGeminiHealth;
  const sleepFn = opts.sleepFn ?? defaultSleep;
  const log = opts.log ?? console.log;

  let result = await attempt();
  if (result.success || !isQuotaExhaustionError(result.errors)) return result;

  log(
    `[quota-watch] exhausted — watching every ${pollIntervalMs}ms (up to ${maxPolls}x, ~${Math.round((maxPolls * pollIntervalMs) / 60_000)} min) for recovery instead of giving up`,
  );
  for (let poll = 1; poll <= maxPolls; poll++) {
    await sleepFn(pollIntervalMs);
    const healthy = await healthCheckFn();
    if (!healthy) {
      log(`[quota-watch] poll ${poll}/${maxPolls} — still unavailable, waiting another ${pollIntervalMs}ms`);
      continue;
    }
    log(`[quota-watch] poll ${poll}/${maxPolls} — models responded, resuming from where it left off`);
    result = await attempt();
    if (result.success || !isQuotaExhaustionError(result.errors)) return result;
    log(`[quota-watch] resumed attempt hit quota exhaustion again — continuing to watch`);
  }
  log(`[quota-watch] gave up after ${maxPolls} polls (~${Math.round((maxPolls * pollIntervalMs) / 60_000)} min) — did not recover in time`);
  return result;
}

// Mirrors stage6-deployment.ts's deployWithQuotaRetry: retries the WHOLE
// generator call (not just the failed step) with a backoff wait, but ONLY
// when the failure is quota-exhaustion-shaped — any other failure reason
// returns immediately unchanged, so a genuine bug still fails fast.
export async function runGeneratorWithQuotaRetry<T extends { success: boolean; errors: string[] }>(
  attempt: () => Promise<T>,
  sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  let result = await attempt();
  let retries = 0;
  while (!result.success && isQuotaExhaustionError(result.errors) && retries < MAX_GENERATOR_QUOTA_RETRIES) {
    retries++;
    console.log(
      `[generator] failed on LLM quota/circuit-breaker exhaustion — waiting ${GENERATOR_QUOTA_RETRY_BACKOFF_MS}ms for recovery before retry ${retries}/${MAX_GENERATOR_QUOTA_RETRIES}`,
    );
    await sleepFn(GENERATOR_QUOTA_RETRY_BACKOFF_MS);
    result = await attempt();
  }
  return result;
}
