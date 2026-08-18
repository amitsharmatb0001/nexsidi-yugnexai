"use client";

import type { WorkstreamActivity } from "../../lib/live";
import s from "./console.module.css";

export default function WorkstreamRoster({
  workstreams,
  selected,
  onSelect,
}: {
  workstreams: WorkstreamActivity[];
  selected: string | null;
  onSelect: (agent: string | null) => void;
}) {
  const activeCount = workstreams.filter((w) => w.active).length;

  return (
    <>
      <div className={s.railTitle}>
        Workstreams
        <span className={s.railCount}>
          {activeCount}/{workstreams.length}
        </span>
      </div>

      {workstreams.length === 0 && (
        <div className={s.vital}>
          <div className={s.vitalName}>no activity yet</div>
        </div>
      )}

      {workstreams.map((w) => (
        <button
          key={w.agent}
          type="button"
          // Clicking the selected row clears the filter, so the roster is a
          // toggle rather than a mode you can get stuck in.
          onClick={() => onSelect(selected === w.agent ? null : w.agent)}
          className={`${s.wsItem} ${selected === w.agent ? s.wsItemSelected : ""}`}
          aria-pressed={selected === w.agent}
        >
          <span className={s.wsHead}>
            <span
              className={`${s.wsDot} ${w.errors > 0 ? s.wsDotError : w.active ? s.wsDotActive : ""}`}
            />
            <span className={s.wsName}>{w.agent}</span>
          </span>
          <span className={s.wsTool}>{w.lastTool}</span>
          <span className={s.wsStats}>
            <span>{w.calls} {w.calls === 1 ? "call" : "calls"}</span>
            {w.errors > 0 && <span className={s.wsStatErr}>{w.errors} err</span>}
          </span>
        </button>
      ))}
    </>
  );
}
