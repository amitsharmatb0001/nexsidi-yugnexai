// Time budgets for the stages that repeat (2026-10-25, brewline3: Amit asked for a clean build in an hour, not four). Nothing in the plan
// or the workflow limited how long the review loop or the live stage could keep starting rounds: the review loop ran two hours, the live
// stage 45 minutes. When a budget is used up the stage stops starting new rounds and holds the build for a human with what is still open;
// a Retry starts a fresh budget. Defaults are what a build needs, measured on brewline3 (review about 15 minutes for a first full pass and
// one fix round; live about 10 minutes a round). Set QA_TIME_BUDGET_MIN / LIVE_TIME_BUDGET_MIN to change one, 0 to switch it off.

export const DEFAULT_QA_BUDGET_MIN = 40;
export const DEFAULT_LIVE_BUDGET_MIN = 30;

function budgetMs(envName: string, defaultMin: number): number {
  const raw = process.env[envName];
  if (raw === undefined || raw.trim() === "") return defaultMin * 60_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return defaultMin * 60_000;
  return n === 0 ? Infinity : n * 60_000;
}

/** How long the review and fix loop may keep starting rounds. */
export const qaBudgetMs = (): number => budgetMs("QA_TIME_BUDGET_MIN", DEFAULT_QA_BUDGET_MIN);

/** How long the live stage (deploy, live review, fix, redeploy) may keep starting fix rounds. */
export const liveBudgetMs = (): number => budgetMs("LIVE_TIME_BUDGET_MIN", DEFAULT_LIVE_BUDGET_MIN);

export const minutesSince = (startedAtMs: number): number => Math.round((Date.now() - startedAtMs) / 60_000);
