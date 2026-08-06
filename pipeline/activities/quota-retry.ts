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
