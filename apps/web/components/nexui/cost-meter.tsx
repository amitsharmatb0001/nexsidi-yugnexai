"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { useMemo, type ReactNode } from "react";

/* ------------------------------------------------------------------ *
 * Model
 * ------------------------------------------------------------------ */

export interface UsageEntry {
  /** Model identifier, used to group the breakdown. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Cached-read input tokens, billed at a lower rate when priced separately. */
  cachedInputTokens?: number;
  /** Epoch milliseconds. Required for burn rate. */
  at?: number;
  /** Overrides the computed cost for this entry, in currency units. */
  cost?: number;
}

/** Price per **million** tokens — the unit model pricing is actually quoted in. */
export interface ModelPricing {
  input: number;
  output: number;
  /** Defaults to `input` when a provider does not discount cache reads. */
  cachedInput?: number;
}

export type PricingTable = Record<string, ModelPricing>;

export interface ModelBreakdown {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  tokens: number;
  cost: number;
}

export interface CostSummary {
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  tokens: number;
  byModel: ModelBreakdown[];
  /** Currency units per hour over the measured window; undefined if unknowable. */
  burnPerHour?: number;
  /** Milliseconds spanned by the entries used for the burn rate. */
  windowMs?: number;
}

const MILLION = 1_000_000;

/** Cost of one entry, in currency units. An explicit `cost` always wins. */
export function costOfEntry(entry: UsageEntry, pricing: PricingTable): number {
  if (entry.cost !== undefined) return entry.cost;

  const rates = pricing[entry.model];
  if (!rates) return 0;

  const cached = entry.cachedInputTokens ?? 0;
  // Cached tokens are a *subset* of input tokens in most provider reporting,
  // so bill the uncached remainder at full rate rather than double-counting.
  const uncachedInput = Math.max(0, entry.inputTokens - cached);
  const cachedRate = rates.cachedInput ?? rates.input;

  return (
    (uncachedInput * rates.input) / MILLION +
    (cached * cachedRate) / MILLION +
    (entry.outputTokens * rates.output) / MILLION
  );
}

export interface SummarizeOptions {
  /**
   * Burn rate window in ms. Only entries within this much of the newest one
   * count, so a long-idle session reports the rate it is *currently* running
   * at rather than an average diluted by the idle time.
   */
  burnWindowMs?: number;
  /** Treated as "now" for the burn window. Defaults to the newest entry. */
  now?: number;
}

/**
 * Aggregates usage into totals, a per-model breakdown, and a burn rate.
 *
 * Burn rate is deliberately measured over the span between the first and last
 * entry *in the window*, not against wall-clock since session start: an agent
 * that ran hard for two minutes and then sat idle for an hour is still burning
 * at its two-minute rate the moment it resumes, and averaging in the idle hour
 * would under-report the number a budget decision depends on.
 */
export function summarizeUsage(
  entries: UsageEntry[],
  pricing: PricingTable = {},
  options: SummarizeOptions = {},
): CostSummary {
  const summary: CostSummary = {
    cost: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    tokens: 0,
    byModel: [],
  };

  if (entries.length === 0) return summary;

  const groups = new Map<string, ModelBreakdown>();

  for (const entry of entries) {
    const cost = costOfEntry(entry, pricing);
    const cached = entry.cachedInputTokens ?? 0;

    summary.cost += cost;
    summary.inputTokens += entry.inputTokens;
    summary.outputTokens += entry.outputTokens;
    summary.cachedInputTokens += cached;

    let group = groups.get(entry.model);
    if (!group) {
      group = {
        model: entry.model,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        tokens: 0,
        cost: 0,
      };
      groups.set(entry.model, group);
    }
    group.inputTokens += entry.inputTokens;
    group.outputTokens += entry.outputTokens;
    group.cachedInputTokens += cached;
    group.tokens += entry.inputTokens + entry.outputTokens;
    group.cost += cost;
  }

  summary.tokens = summary.inputTokens + summary.outputTokens;
  summary.byModel = [...groups.values()].sort((a, b) => b.cost - a.cost || a.model.localeCompare(b.model));

  // Burn rate needs timestamps and at least two distinct instants to divide by.
  const timed = entries.filter((entry) => entry.at !== undefined) as Array<UsageEntry & { at: number }>;
  if (timed.length >= 2) {
    const newest = options.now ?? Math.max(...timed.map((entry) => entry.at));
    const windowMs = options.burnWindowMs;
    const inWindow = windowMs === undefined ? timed : timed.filter((entry) => newest - entry.at <= windowMs);

    if (inWindow.length >= 2) {
      const first = Math.min(...inWindow.map((entry) => entry.at));
      const last = Math.max(...inWindow.map((entry) => entry.at));
      const span = last - first;

      if (span > 0) {
        const windowCost = inWindow.reduce((sum, entry) => sum + costOfEntry(entry, pricing), 0);
        summary.burnPerHour = (windowCost / span) * 3_600_000;
        summary.windowMs = span;
      }
    }
  }

  return summary;
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

/**
 * Formats a cost, keeping small amounts legible.
 *
 * A per-request cost is routinely a fraction of a cent, and rounding that to
 * "$0.00" makes the meter useless exactly where people are watching it most
 * closely — so precision scales with magnitude instead of being fixed at two.
 */
export function formatCost(value: number, currency = "$"): string {
  const abs = Math.abs(value);
  if (abs === 0) return `${currency}0.00`;
  if (abs < 0.01) return `${currency}${value.toFixed(4)}`;
  if (abs < 1) return `${currency}${value.toFixed(3)}`;
  if (abs < 1000) return `${currency}${value.toFixed(2)}`;
  return `${currency}${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/** Compact token counts: 1234 -> 1.2K, 1234567 -> 1.2M. */
export function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < MILLION) return `${(value / 1000).toFixed(1)}K`;
  return `${(value / MILLION).toFixed(2)}M`;
}

/* ------------------------------------------------------------------ *
 * Styles
 * ------------------------------------------------------------------ */

const rootClass = css({
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.sm,
  color: theme.color.foreground,
  border: `1px solid ${theme.color.border}`,
  borderRadius: theme.radius.md,
  backgroundColor: theme.color.card,
  padding: theme.space[3],
  display: "flex",
  flexDirection: "column",
  gap: theme.space[2.5],
});

const headRowClass = css({
  display: "flex",
  alignItems: "baseline",
  gap: theme.space[2],
  flexWrap: "wrap",
});

const totalClass = css({
  fontFamily: theme.fontFamily.mono,
  fontSize: theme.fontSize["2xl"],
  fontWeight: theme.fontWeight.semibold,
  fontVariantNumeric: "tabular-nums",
  lineHeight: 1,
});

const labelClass = css({
  fontSize: theme.fontSize.xs,
  color: theme.color.mutedForeground,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
});

const burnClass = css({
  marginLeft: "auto",
  fontFamily: theme.fontFamily.mono,
  fontSize: theme.fontSize.xs,
  fontVariantNumeric: "tabular-nums",
  color: theme.color.mutedForeground,
});

const trackClass = css({
  position: "relative",
  width: "100%",
  height: "8px",
  borderRadius: "9999px",
  backgroundColor: theme.color.muted,
  overflow: "hidden",
});

const fillClass = css({
  height: "100%",
  borderRadius: "9999px",
  transitionProperty: "width, background-color",
  transitionDuration: theme.duration.slow,
  transitionTimingFunction: theme.easing.decelerate,
});

const budgetRowClass = css({
  display: "flex",
  justifyContent: "space-between",
  gap: theme.space[2],
  fontSize: theme.fontSize.xs,
  color: theme.color.mutedForeground,
  fontVariantNumeric: "tabular-nums",
});

const tokenRowClass = css({
  display: "flex",
  gap: theme.space[3],
  fontSize: theme.fontSize.xs,
  color: theme.color.mutedForeground,
  fontFamily: theme.fontFamily.mono,
  fontVariantNumeric: "tabular-nums",
  flexWrap: "wrap",
});

const breakdownClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[1],
  paddingTop: theme.space[2],
  borderTop: `1px solid ${theme.color.border}`,
});

const modelRowClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[2],
  fontSize: theme.fontSize.xs,
});

const modelNameClass = css({
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontFamily: theme.fontFamily.mono,
});

const modelBarClass = css({
  width: "4rem",
  height: "5px",
  borderRadius: "9999px",
  backgroundColor: theme.color.muted,
  overflow: "hidden",
  flexShrink: 0,
});

const modelBarFillClass = css({
  height: "100%",
  borderRadius: "9999px",
  backgroundColor: theme.color.primary,
});

const modelCostClass = css({
  fontFamily: theme.fontFamily.mono,
  fontVariantNumeric: "tabular-nums",
  minWidth: "4rem",
  textAlign: "right",
  flexShrink: 0,
});

/** Budget tiers. Colour shifts before the cap, not at it. */
function tierColor(ratio: number): string {
  if (ratio >= 1) return theme.color.destructive;
  if (ratio >= 0.9) return theme.color.destructive;
  if (ratio >= 0.75) return theme.color.warning;
  return theme.color.primary;
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export interface CostMeterProps {
  entries: UsageEntry[];
  /** Price per million tokens, keyed by model. */
  pricing?: PricingTable;
  /** Spend cap in currency units. Enables the budget bar. */
  budget?: number;
  currency?: string;
  /** Burn-rate window in ms. Defaults to the whole session. */
  burnWindowMs?: number;
  /** Shows the per-model breakdown. */
  showBreakdown?: boolean;
  /** Shows the input/output token line. */
  showTokens?: boolean;
  label?: string;
  /** Replaces the headline figure. */
  headline?: ReactNode;
  className?: string;
}

/**
 * Cumulative spend, burn rate, and an optional budget cap.
 *
 * Where `token-meter` answers "how full is the context window", this answers
 * "how much has this session cost, and how fast is that growing" — the
 * question that decides whether to let an agent keep running.
 */
export function CostMeter({
  entries,
  pricing = {},
  budget,
  currency = "$",
  burnWindowMs,
  showBreakdown = true,
  showTokens = true,
  label = "Session cost",
  headline,
  className,
}: CostMeterProps) {
  const summary = useMemo(
    () => summarizeUsage(entries, pricing, { burnWindowMs }),
    [entries, pricing, burnWindowMs],
  );

  const ratio = budget && budget > 0 ? summary.cost / budget : 0;
  const clamped = Math.min(Math.max(ratio, 0), 1);
  const color = tierColor(ratio);
  const maxModelCost = summary.byModel.reduce((max, m) => Math.max(max, m.cost), 0);
  const overBudget = budget !== undefined && budget > 0 && summary.cost > budget;

  return (
    <div className={className ? `${rootClass} ${className}` : rootClass} aria-label={label}>
      <div className={headRowClass}>
        {headline ?? (
          <>
            <span className={totalClass} style={overBudget ? { color: theme.color.destructive } : undefined}>
              {formatCost(summary.cost, currency)}
            </span>
            <span className={labelClass}>spent</span>
          </>
        )}

        {summary.burnPerHour !== undefined ? (
          <span className={burnClass} title="Rate over the measured window">
            {formatCost(summary.burnPerHour, currency)}/hr
          </span>
        ) : null}
      </div>

      {budget !== undefined && budget > 0 ? (
        <>
          <div
            className={trackClass}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={budget}
            aria-valuenow={Math.min(summary.cost, budget)}
            aria-label={`${formatCost(summary.cost, currency)} of ${formatCost(budget, currency)} budget`}
          >
            <div className={fillClass} style={{ width: `${clamped * 100}%`, backgroundColor: color }} />
          </div>
          <div className={budgetRowClass}>
            <span>{Math.round(ratio * 100)}% of budget</span>
            <span style={overBudget ? { color: theme.color.destructive } : undefined}>
              {overBudget
                ? `${formatCost(summary.cost - budget, currency)} over`
                : `${formatCost(budget - summary.cost, currency)} left`}
            </span>
          </div>
        </>
      ) : null}

      {showTokens && summary.tokens > 0 ? (
        <div className={tokenRowClass}>
          <span>{formatTokens(summary.tokens)} tokens</span>
          <span>in {formatTokens(summary.inputTokens)}</span>
          <span>out {formatTokens(summary.outputTokens)}</span>
          {summary.cachedInputTokens > 0 ? <span>cached {formatTokens(summary.cachedInputTokens)}</span> : null}
        </div>
      ) : null}

      {showBreakdown && summary.byModel.length > 0 ? (
        <div className={breakdownClass}>
          {summary.byModel.map((model) => (
            <div key={model.model} className={modelRowClass}>
              <span className={modelNameClass} title={model.model}>
                {model.model}
              </span>
              <span className={modelBarClass} aria-hidden="true">
                <span
                  className={modelBarFillClass}
                  style={{ width: maxModelCost > 0 ? `${(model.cost / maxModelCost) * 100}%` : "0%" }}
                />
              </span>
              <span className={modelCostClass}>{formatCost(model.cost, currency)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
