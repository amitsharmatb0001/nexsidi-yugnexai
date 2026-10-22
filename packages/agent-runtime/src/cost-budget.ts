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
import { ACTIVE_NIM_MODELS, OLLAMA_MODELS } from "@nexsidi/llm-client";

export interface ModelRate {
  inputPerMillion: number;
  outputPerMillion: number;
  // Price for input tokens served from the prompt cache. Absent = no cache
  // discount known, charge the full input rate (safe direction).
  cachedInputPerMillion?: number;
}

export type PricedModel =
  | "gemini-4-argon"
  | "gemini-3.1-pro-preview"
  | "gemini-3.5-flash"
  | "gemini-3.6-flash"
  | "gemini-3.7-flash"
  | "gemini-3.8-flash"
  | "gemini-2.5-flash-lite"
  | "claude-sonnet-5"
  | "claude-opus-4-8"
  | "claude-haiku-4-5";

// $/1M tokens.
//
// 2026-09-28: Gemini rates are Google's PUBLISHED paid-tier prices, read from
// ai.google.dev/gemini-api/docs/pricing on 2026-09-28 — this block used to be
// estimates extrapolated from 2.5-generation pricing, and was wrong in both
// directions: 3.5-flash is $1.50/$9.00 (was guessed $0.30/$2.50), 3.1-pro is
// $2/$12 (guessed $1.25/$10), and gemini-3.7-flash was MISSING entirely, so
// every call on it fell through to FALLBACK_RATE (Opus, $5/$25) — the direct
// cause of project a61968de2ecf "spending" $55.23 (really ~$10) and being
// halted before deploy. Output prices include thinking tokens (Google bills
// them as output — see gemini.ts's billedOutputTokens). 3.1-pro is the
// <=200K-prompt tier ($4/$18 above that); no NexSidi prompt gets near 200K.
//
// 3.6/3.7/3.8 flash are on introductory pricing through 2026-12-31 and
// double on 2027-01-01 (Google's own dates) — encoded below so the counter
// switches on the day instead of silently under-counting by half.
//
// Claude — per this task's brief (claude-api skill's pricing reference):
// Sonnet 5 intro pricing is given as a $2-3in/$10-15out range; the concrete
// point estimate used here ($3/$15, <=200K context) is the real,
// well-documented Sonnet-4.5-class rate, which is inside that stated range.
// Opus 4.8 ($5/$25) and Haiku 4.5 ($1/$5) are used exactly as given. This
// table exists so budget math is ready the moment a Claude backend is
// actually enabled — Claude-on-Vertex is currently blocked project-wide
// (see gemini.ts's header comment) — not because it's in use today.
const FLASH_3X_STANDARD: ModelRate = { inputPerMillion: 1.5, outputPerMillion: 7.5, cachedInputPerMillion: 0.15 };
const FLASH_3X_INTRO: ModelRate = { inputPerMillion: 0.75, outputPerMillion: 3.75, cachedInputPerMillion: 0.075 };
const FLASH_3X_INTRO_ENDS = Date.parse("2027-01-01T00:00:00Z");

// 2026-10-21: gemini-4-argon. The model card gives no price; third-party pages report $2/$10 per million tokens introductory and
// $4/$20 from 2026-12-01, cached input 95% off. NOT verified against Google. The standard rate is used from the start, so the
// budget counts about twice the real cost until the introductory period ends instead of under-counting.
const PRICING: Record<PricedModel, ModelRate> = {
  "gemini-4-argon": { inputPerMillion: 4.0, outputPerMillion: 20.0, cachedInputPerMillion: 0.2 },
  "gemini-3.1-pro-preview": { inputPerMillion: 2.0, outputPerMillion: 12.0, cachedInputPerMillion: 0.2 },
  "gemini-3.5-flash": { inputPerMillion: 1.5, outputPerMillion: 9.0, cachedInputPerMillion: 0.15 },
  "gemini-3.6-flash": FLASH_3X_STANDARD,
  "gemini-3.7-flash": FLASH_3X_STANDARD,
  "gemini-3.8-flash": FLASH_3X_STANDARD,
  "gemini-2.5-flash-lite": { inputPerMillion: 0.1, outputPerMillion: 0.4, cachedInputPerMillion: 0.01 },
  "claude-sonnet-5": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  "claude-opus-4-8": { inputPerMillion: 5.0, outputPerMillion: 25.0 },
  "claude-haiku-4-5": { inputPerMillion: 1.0, outputPerMillion: 5.0 },
};

const INTRO_PRICED = new Set<string>(["gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash"]);

// Fallback for a model name not in PRICING (e.g. a new model added to a
// router pool before this table is updated). Priced at the highest rate in
// the table on purpose: an unpriced model should make the budget halt
// TOO EARLY (safe — just an unnecessary escalation) rather than never halt
// at all (unsafe — exactly the unbounded-spend gap this task exists to
// close). Reusing claude-opus-4-8's rate (this table's most expensive
// entry) keeps that guarantee without hardcoding a second magic number.
// cost-budget.test.ts now fails the build if any router-pool model is
// missing here, so this should only ever catch a model outside the pools.
const FALLBACK_RATE: ModelRate = PRICING["claude-opus-4-8"];

// 2026-09-29: same incident class as 3.7-flash above, bigger (project
// a034f90ba50e). The NIM loop records each call under the NIM model's name
// and no NIM model was in PRICING, so every call on NVIDIA's FREE dev tier was
// charged at FALLBACK_RATE: ~$63 of a recorded $88.73 was phantom (real Gemini
// spend ~$25) and the build was halted twice by a cap it never reached. NIM
// (free dev tier) and local Ollama models cost nothing.
const FREE_RATE: ModelRate = { inputPerMillion: 0, outputPerMillion: 0, cachedInputPerMillion: 0 };
const FREE_MODELS: ReadonlySet<string> = new Set<string>([...ACTIVE_NIM_MODELS, ...OLLAMA_MODELS]);

export function isPricedModel(model: string): boolean {
  return Object.hasOwn(PRICING, model) || FREE_MODELS.has(model);
}

export function rateForModel(model: string, now: Date = new Date()): ModelRate {
  if (FREE_MODELS.has(model)) return FREE_RATE;
  if (INTRO_PRICED.has(model) && now.getTime() < FLASH_3X_INTRO_ENDS) return FLASH_3X_INTRO;
  return (PRICING as Record<string, ModelRate>)[model] ?? FALLBACK_RATE;
}

/**
 * Cost of one call. `cachedTokensIn` is the part of `tokensIn` served from
 * the prompt cache (Gemini's cachedContentTokenCount), billed at the model's
 * cache rate instead of the full input rate.
 */
export function computeCostUsd(
  tokensIn: number,
  tokensOut: number,
  model: string,
  cachedTokensIn = 0,
  now: Date = new Date(),
): number {
  const rate = rateForModel(model, now);
  const cached = Math.min(Math.max(cachedTokensIn, 0), tokensIn);
  const cachedRate = rate.cachedInputPerMillion ?? rate.inputPerMillion;
  return ((tokensIn - cached) / 1_000_000) * rate.inputPerMillion
    + (cached / 1_000_000) * cachedRate
    + (tokensOut / 1_000_000) * rate.outputPerMillion;
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
  /** 2026-10-22: the same call added to its agent's row in agent_spend (optional: test stores may leave it out). */
  addAgentTotals?(projectId: string, agent: string, model: string, deltaTokensIn: number, deltaTokensOut: number, cachedTokensIn: number, deltaCostUsd: number): Promise<void>;
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
  async addAgentTotals(projectId, agent, model, deltaTokensIn, deltaTokensOut, cachedTokensIn, deltaCostUsd) {
    const { db } = await import("@nexsidi/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      INSERT INTO agent_spend (project_id, agent, model, calls, tokens_in, tokens_out, cached_in, cost_usd, updated_at)
      VALUES (${projectId}, ${agent}, ${model}, 1, ${deltaTokensIn}, ${deltaTokensOut}, ${cachedTokensIn}, ${deltaCostUsd.toFixed(6)}, now())
      ON CONFLICT (project_id, agent, model) DO UPDATE SET
        calls = agent_spend.calls + 1,
        tokens_in = agent_spend.tokens_in + EXCLUDED.tokens_in,
        tokens_out = agent_spend.tokens_out + EXCLUDED.tokens_out,
        cached_in = agent_spend.cached_in + EXCLUDED.cached_in,
        cost_usd = agent_spend.cost_usd + EXCLUDED.cost_usd,
        updated_at = now()`);
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
  cachedTokensIn = 0,
  agent?: string,
): Promise<void> {
  const costUsd = computeCostUsd(tokensIn, tokensOut, model, cachedTokensIn);
  await store.addTotals(projectId, tokensIn, tokensOut, costUsd);
  // The per-agent row is a breakdown of the total above; a failure here must never lose the total (or stop a build).
  if (agent && store.addAgentTotals) {
    try {
      await store.addAgentTotals(projectId, agent, model, tokensIn, tokensOut, cachedTokensIn, costUsd);
    } catch (err) {
      console.warn(`[spend] could not add to ${agent}'s spend row (the project total is recorded): ${String(err).slice(0, 160)}`);
    }
  }
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
