// Time limit for the NIM leg of an escalated agent run.
//
// Measured on project a034f90ba50e: successful NIM runs took 1-12 min (the
// slowest 30); NIM runs that never finished burned 40-60 min before handing
// over, and Gemini then finished the same job in ~10. runAgentEscalated passes
// this budget to the NIM leg only — there Gemini is the fallback. Nothing else
// sets it, so a direct NIM caller (no fallback) is never cut short.
//
// Off switch: NIM_RUN_MAX_MINUTES=0.

const DEFAULT_MINUTES = 20;

export function nimTimeBudgetMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.NIM_RUN_MAX_MINUTES?.trim();
  const minutes = raw === undefined || raw === "" ? DEFAULT_MINUTES : Number(raw);
  if (!Number.isFinite(minutes) || minutes < 0) return DEFAULT_MINUTES * 60_000;
  return minutes * 60_000;
}

export function timeBudgetExceeded(startedAt: number, now: number, budgetMs: number): boolean {
  return budgetMs > 0 && now - startedAt > budgetMs;
}
