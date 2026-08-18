"use client";

import type { CircuitState, RpmState, SystemVitals as Vitals } from "../../lib/live";
import s from "./console.module.css";

/**
 * Strips the vendor prefix from a model id for display ("moonshotai/kimi-k2.6"
 * -> "kimi-k2.6"). The rail is 268px wide; a full id truncates to nothing
 * useful, and the vendor is the least distinguishing part of it.
 */
export function shortModelName(modelId: string): string {
  const tail = modelId.includes("/") ? modelId.slice(modelId.lastIndexOf("/") + 1) : modelId;
  return tail.length > 22 ? `${tail.slice(0, 21)}…` : tail;
}

/** Circuit states worth surfacing first — a tripped breaker is why a build stalls. */
export function circuitRank(state: CircuitState): number {
  if (state === "OPEN") return 0;
  if (state === "HALF_OPEN") return 1;
  return 2;
}

function CircuitPill({ state }: { state: CircuitState }) {
  const cls =
    (state === "OPEN" ? s.pillOpen : state === "HALF_OPEN" ? s.pillHalf : s.pillOk) ?? "";
  const label = state === "HALF_OPEN" ? "testing" : state === "OPEN" ? "open" : "ok";
  return <span className={`${s.pill} ${cls}`}>{label}</span>;
}

function meterClass(pct: number): string {
  if (pct >= 90) return `${s.meterFill} ${s.meterHot}`;
  if (pct >= 65) return `${s.meterFill} ${s.meterWarn}`;
  return s.meterFill ?? "";
}

export default function SystemVitals({ vitals }: { vitals: Vitals | null }) {
  if (!vitals) {
    return (
      <div className={s.vital}>
        <div className={s.vitalName}>waiting for telemetry…</div>
      </div>
    );
  }

  const circuits = Object.entries(vitals.circuits).sort(
    ([aName, aState], [bName, bState]) =>
      circuitRank(aState) - circuitRank(bState) || aName.localeCompare(bName),
  );

  // Only models that have actually been used carry meaningful utilisation;
  // a full roster of idle models at 0% is noise in a narrow rail.
  const rpm = Object.entries(vitals.rpm)
    .filter(([, r]) => (r as RpmState).utilizationPct > 0)
    .sort(([, a], [, b]) => (b as RpmState).utilizationPct - (a as RpmState).utilizationPct);

  return (
    <>
      <div className={s.railTitle}>
        Model circuits
        <span className={s.railCount}>{circuits.length}</span>
      </div>

      {circuits.length === 0 && (
        <div className={s.vital}>
          <div className={s.vitalName}>no calls yet</div>
        </div>
      )}

      {circuits.map(([model, state]) => (
        <div key={model} className={s.vital}>
          <div className={s.vitalRow}>
            <span className={s.vitalName} title={model}>{shortModelName(model)}</span>
            <CircuitPill state={state} />
          </div>
        </div>
      ))}

      <div className={s.railTitle}>
        Rate limit
        <span className={s.railCount}>{rpm.length}</span>
      </div>

      {rpm.length === 0 && (
        <div className={s.vital}>
          <div className={s.vitalName}>all models idle</div>
        </div>
      )}

      {rpm.map(([model, r]) => {
        const pct = Math.max(0, Math.min(100, (r as RpmState).utilizationPct));
        return (
          <div key={model} className={s.vital}>
            <div className={s.vitalRow}>
              <span className={s.vitalName} title={model}>{shortModelName(model)}</span>
              <span className={s.vitalValue}>{pct}%</span>
            </div>
            <div className={s.meter}>
              <div className={meterClass(pct)} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </>
  );
}
