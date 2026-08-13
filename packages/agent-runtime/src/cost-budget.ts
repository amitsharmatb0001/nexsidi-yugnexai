// Task 1 of docs/nexsidi/plans/2026-08-11-cost-control.md — a hard
// per-project token/$ budget that halts a project BEFORE overspend instead
// of discovering it after. Direct response to a real incident: a project
// burned $29K of GCP/Gemini credits in a week because nothing anywhere in
// the pipeline ever checked a running dollar total against a ceiling.
//
// The pure pricing/cap math below has zero dependency on a live DB — fully
// unit-testable with no DATABASE_URL set, same discipline as
// packages/db/src/instincts.ts's pure helpers (buildInstinctRecord,
// escalateConfidence, etc). recordSpend/checkBudget (the DB-touching
// functions) accept an optional SpendStore override for the same reason:
// tests exercise the real accumulate-then-halt logic without needing a live
// Postgres, while production callers (pipeline/activities/index.ts) get the
// real Drizzle-backed store by simply not passing one.

// ── Pricing ──────────────────────────────────────────────────────────────
export interface ModelRate {
  inputPerMillion: number;
  outputPerMillion: number;
}

export type PricedModel =
  | "gemini-3.1-pro-preview"
  | "gemini-3.5-flash"
  | "gemini-3.6-flash"
  | "gemini-2.5-flash-lite"
  | "claude-sonnet-5"
  | "claude-opus-4-8"
  | "claude-haiku-4-5";

// $/1M tokens.
//
// Gemini (Vertex AI) — no official 3.x pricing exists anywhere in this repo
// and none was found live (grepped the full repo for "pricing"/"$/1M"/
// "per million" before writing this table — the only hits were unrelated
// UI copy, not a rate card). These are ESTIMATES, extrapolated from
// Google's publicly documented Gemini 2.5-generation pricing (2.5 Flash:
// $0.30 in / $2.50 out per 1M; 2.5 Pro, <=200K context: $1.25 in / $10.00
// out per 1M; 2.5 Flash-Lite: $0.10 in / $0.40 out per 1M) onto the same
// tier for the 3.x model names this repo actually calls (see gemini.ts's
// resolveGeminiModel/GEMINI_ESCALATION_MODEL). "Flash-tier cost" is
// explicitly how Google positions 3.5/3.6 Flash in this repo's own
// reference docs (gemini_3_5_flash.md / gemini_3_6_flash.md), so mapping
// them onto the 2.5 Flash price tier is the closest documented anchor
// available. gemini-3.6-flash is nudged slightly above 3.5 (not identical)
// only to avoid the table silently implying the two are priced the same —
// update this whole block the moment real 3.x pricing is published; it is
// a placeholder for budget math, not a bill.
//
// Claude — per this task's brief (claude-api skill's pricing reference):
// Sonnet 5 intro pricing is given as a $2-3in/$10-15out range; the concrete
// point estimate used here ($3/$15, <=200K context) is the real,
// well-documented Sonnet-4.5-class rate, which is inside that stated range.
// Opus 4.8 ($5/$25) and Haiku 4.5 ($1/$5) are used exactly as given. This
// table exists so budget math is ready the moment a Claude backend is
// actually enabled — Claude-on-Vertex is currently blocked project-wide
// (see gemini.ts's header comment) — not because it's in use today.
const PRICING: Record<PricedModel, ModelRate> = {
  "gemini-3.1-pro-preview": { inputPerMillion: 1.25, outputPerMillion: 10.0 },
  "gemini-3.5-flash": { inputPerMillion: 0.3, outputPerMillion: 2.5 },
  "gemini-3.6-flash": { inputPerMillion: 0.35, outputPerMillion: 2.75 },
  "gemini-2.5-flash-lite": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  "claude-sonnet-5": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  "claude-opus-4-8": { inputPerMillion: 5.0, outputPerMillion: 25.0 },
  "claude-haiku-4-5": { inputPerMillion: 1.0, outputPerMillion: 5.0 },
};

// Fallback for a model name not in PRICING (e.g. a new model added to a
// router pool before this table is updated). Priced at the highest rate in
// the table on purpose: an unpriced model should make the budget halt
// TOO EARLY (safe — just an unnecessary escalation) rather than never halt
// at all (unsafe — exactly the unbounded-spend gap this task exists to
// close). Reusing claude-opus-4-8's rate (this table's most expensive
// entry) keeps that guarantee without hardcoding a second magic number.
const FALLBACK_RATE: ModelRate = PRICING["claude-opus-4-8"];

export function rateForModel(model: string): ModelRate {
  return (PRICING as Record<string, ModelRate>)[model] ?? FALLBACK_RATE;
}

export function computeCostUsd(tokensIn: number, tokensOut: number, model: string): number {
  const rate = rateForModel(model);
  return (tokensIn / 1_000_000) * rate.inputPerMillion + (tokensOut / 1_000_000) * rate.outputPerMillion;
}

// ── Cap resolution ───────────────────────────────────────────────────────
// COST_BUDGET_CAP_USD — per-project hard cap, in USD. Unset uses this
// default rather than breaking existing behavior (this lever must be
// individually toggleable/revertable per the cost-control plan's global
// constraints). Default reasoning: real Sprint-1 builds (nextech10 and
// others) have run to tens of dollars per project, not thousands — $50
// gives real headroom for a full generate+QA+fix-iterate+deploy cycle
// while stopping vastly short of the $29K/week incident this plan exists
// to prevent (that incident had zero ceiling, not merely a high one).
const DEFAULT_BUDGET_CAP_USD = 50;

export function resolveBudgetCapUsd(): number {
  const override = process.env.COST_BUDGET_CAP_USD?.trim();
  const parsed = override ? Number(override) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BUDGET_CAP_USD;
}

export interface BudgetStatus {
  withinBudget: boolean;
  spentUsd: number;
  capUsd: number;
}

// Pure: no I/O. recordSpend/checkBudget below are just this plus
// persistence — kept separate so the actual halt/continue DECISION is
// unit-testable without touching a store at all.
export function evaluateBudget(spentUsd: number, capUsd: number): BudgetStatus {
  return { withinBudget: spentUsd < capUsd, spentUsd, capUsd };
}

// ── Persistence ──────────────────────────────────────────────────────────
// SpendStore is the seam tests use to exercise recordSpend/checkBudget's
// real accumulation/cap-crossing logic without a live Postgres — same
// reason packages/db/src/instincts.ts's DB-touching functions do a dynamic
// `await import("./client.ts")` instead of a top-level import: importing
// this module must never require DATABASE_URL to be set.
export interface SpendTotals {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface SpendStore {
  getTotals(projectId: string): Promise<SpendTotals | null>;
  addTotals(projectId: string, deltaTokensIn: number, deltaTokensOut: number, deltaCostUsd: number): Promise<void>;
}

// Real store — dynamic import so requiring this module never requires a
// live DB connection (mirrors instincts.ts's recordInstinct/
// queryRecentInstincts). One row per project in `token_spend`
// (packages/db/src/schema.ts), accumulated via UPSERT so a read is O(1)
// regardless of how many LLM calls a project has made — never re-derived
// by summing a log table on every check.
const dbSpendStore: SpendStore = {
  async getTotals(projectId) {
    const { db, tokenSpend } = await import("@nexsidi/db");
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select({
        tokensIn: tokenSpend.totalTokensIn,
        tokensOut: tokenSpend.totalTokensOut,
        costUsd: tokenSpend.totalCostUsd,
      })
      .from(tokenSpend)
      .where(eq(tokenSpend.projectId, projectId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { tokensIn: row.tokensIn, tokensOut: row.tokensOut, costUsd: Number(row.costUsd) };
  },
  async addTotals(projectId, deltaTokensIn, deltaTokensOut, deltaCostUsd) {
    const { db, tokenSpend } = await import("@nexsidi/db");
    const { sql } = await import("drizzle-orm");
    await db
      .insert(tokenSpend)
      .values({
        projectId,
        totalTokensIn: deltaTokensIn,
        totalTokensOut: deltaTokensOut,
        // numeric column — Drizzle's postgres-js driver expects numeric
        // values as strings on insert (avoids float rounding surprises on
        // the wire); toFixed(6) matches the column's scale (12,6).
        totalCostUsd: deltaCostUsd.toFixed(6),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: tokenSpend.projectId,
        set: {
          totalTokensIn: sql`${tokenSpend.totalTokensIn} + ${deltaTokensIn}`,
          totalTokensOut: sql`${tokenSpend.totalTokensOut} + ${deltaTokensOut}`,
          totalCostUsd: sql`${tokenSpend.totalCostUsd} + ${deltaCostUsd}`,
          updatedAt: new Date(),
        },
      });
  },
};

// Produces: recordSpend(projectId, tokensIn, tokensOut, model) — persists a
// running per-project token/cost total. `store` defaults to the real
// Drizzle-backed table; tests pass an in-memory fake instead.
export async function recordSpend(
  projectId: string,
  tokensIn: number,
  tokensOut: number,
  model: string,
  store: SpendStore = dbSpendStore,
): Promise<void> {
  const costUsd = computeCostUsd(tokensIn, tokensOut, model);
  await store.addTotals(projectId, tokensIn, tokensOut, costUsd);
}

// Produces: checkBudget(projectId) — computes cost so far against the
// configurable cap and reports whether the project is still within budget.
// A project with no recorded spend yet is treated as $0 spent (within
// budget), not an error.
export async function checkBudget(
  projectId: string,
  store: SpendStore = dbSpendStore,
): Promise<BudgetStatus> {
  const totals = await store.getTotals(projectId);
  const spentUsd = totals?.costUsd ?? 0;
  return evaluateBudget(spentUsd, resolveBudgetCapUsd());
}
