"use client";

import { useMemo } from "react";
import type { StreamItem, WorkstreamActivity } from "../../lib/live";
import { floor as s } from "./Floor.styles";

/**
 * The Floor — the pipeline drawn as the organisation it actually is, rather
 * than as a list of tool calls.
 *
 * Everything rendered here is derived from real events. Nothing animates
 * unless the underlying workstream genuinely emitted something: a station
 * only lights when its own events arrive, and an attack arc is only drawn
 * when a QA workstream actually produced a finding or escalation. A decorative
 * pulse on an idle pipeline would make this a screensaver instead of an
 * instrument.
 */

export interface Station {
  /** Public workstream label — matches the API's sanitised event `agent`. */
  id: string;
  x: number;
  y: number;
  /** Column band, used for the connecting edges. */
  band: "intake" | "make" | "attack" | "ship";
}

const VB_W = 1000;
const VB_H = 360;

export const STATIONS: Station[] = [
  { id: "Requirements",    x:  70, y: 180, band: "intake" },
  { id: "Planning",        x: 210, y: 180, band: "intake" },

  { id: "Backend",         x: 400, y:  80, band: "make" },
  { id: "Frontend",        x: 400, y: 180, band: "make" },
  { id: "Database",        x: 400, y: 280, band: "make" },

  { id: "Logic QA",        x: 620, y:  80, band: "attack" },
  { id: "Security QA",     x: 620, y: 180, band: "attack" },
  { id: "Performance QA",  x: 620, y: 280, band: "attack" },

  { id: "Deployment",      x: 820, y: 180, band: "ship" },
];

const MAKERS = STATIONS.filter((s) => s.band === "make");
const ATTACKERS = STATIONS.filter((s) => s.band === "attack");

/** Tools that mean a QA workstream fired a finding back at a maker. */
const ATTACK_TOOLS = new Set(["escalate_finding", "submit_findings"]);

export interface FloorSignal {
  /** Stations with recent activity, keyed by public label. */
  active: Set<string>;
  /** Per-station rollup for the labels. */
  byId: Map<string, WorkstreamActivity>;
  /** True while any QA workstream is currently firing findings. */
  attacking: boolean;
  /** Total findings/escalations seen — the adversarial loop's real counter. */
  attackCount: number;
}

export function deriveFloorSignal(
  workstreams: WorkstreamActivity[],
  items: StreamItem[],
  now: number,
  attackWindowMs = 30_000,
): FloorSignal {
  const byId = new Map(workstreams.map((w) => [w.agent, w]));
  const active = new Set(workstreams.filter((w) => w.active).map((w) => w.agent));

  let attackCount = 0;
  let lastAttackAt = 0;
  for (const item of items) {
    if (item.kind !== "event") continue;
    if (item.event.type !== "tool_call") continue;
    if (!ATTACK_TOOLS.has(item.event.tool)) continue;
    attackCount++;
    if (item.event.ts > lastAttackAt) lastAttackAt = item.event.ts;
  }

  return {
    active,
    byId,
    attacking: lastAttackAt > 0 && now - lastAttackAt < attackWindowMs,
    attackCount,
  };
}

/** Cubic path between two stations, bowed so parallel edges stay readable. */
function edgePath(a: Station, b: Station, bow = 0): string {
  const mx = (a.x + b.x) / 2;
  return `M ${a.x} ${a.y} C ${mx} ${a.y + bow}, ${mx} ${b.y + bow}, ${b.x} ${b.y}`;
}

/** The feedback arc: QA findings travelling back to the agent that wrote the code. */
function attackPath(from: Station, to: Station): string {
  // Bowed well below the stations so the return path reads as a distinct
  // loop rather than another forward edge.
  const lift = 150;
  return `M ${from.x} ${from.y} C ${from.x - 60} ${from.y + lift}, ${to.x + 60} ${to.y + lift}, ${to.x} ${to.y}`;
}

export default function Floor({
  workstreams,
  items,
  now,
  stage,
  onSelect,
  selected,
}: {
  workstreams: WorkstreamActivity[];
  items: StreamItem[];
  now: number;
  stage: string;
  onSelect: (agent: string | null) => void;
  selected: string | null;
}) {
  const signal = useMemo(
    () => deriveFloorSignal(workstreams, items, now),
    [workstreams, items, now],
  );

  const forwardEdges = useMemo(() => {
    const out: { d: string; live: boolean; key: string }[] = [];
    const req = STATIONS[0]!;
    const plan = STATIONS[1]!;
    const ship = STATIONS.find((s) => s.id === "Deployment")!;

    out.push({
      key: "req-plan",
      d: edgePath(req, plan),
      live: signal.active.has("Requirements") || signal.active.has("Planning"),
    });

    for (const m of MAKERS) {
      out.push({
        key: `plan-${m.id}`,
        d: edgePath(plan, m),
        live: signal.active.has(m.id),
      });
    }
    // Makers converge on the attackers: the review reads the merged output,
    // so every maker feeds every reviewer.
    for (const m of MAKERS) {
      for (const a of ATTACKERS) {
        out.push({
          key: `${m.id}-${a.id}`,
          d: edgePath(m, a),
          live: signal.active.has(a.id),
        });
      }
    }
    for (const a of ATTACKERS) {
      out.push({
        key: `${a.id}-ship`,
        d: edgePath(a, ship),
        live: signal.active.has("Deployment"),
      });
    }
    return out;
  }, [signal]);

  const attackEdges = useMemo(
    () =>
      ATTACKERS.flatMap((a) =>
        MAKERS.map((m) => ({
          key: `atk-${a.id}-${m.id}`,
          d: attackPath(a, m),
          live: signal.attacking && signal.active.has(a.id),
        })),
      ),
    [signal],
  );

  return (
    <div className={s.wrap}>
      <div className={s.legend}>
        <span className={s.legendItem}>
          <i className={`${s.swatch} ${s.swatchFlow}`} /> handoff
        </span>
        <span className={s.legendItem}>
          <i className={`${s.swatch} ${s.swatchAttack}`} /> findings fired back
        </span>
        <span className={s.legendCount}>
          {signal.attackCount} {signal.attackCount === 1 ? "finding" : "findings"} raised
        </span>
      </div>

      <svg className={s.svg} viewBox={`0 0 ${VB_W} ${VB_H}`} role="img" aria-label="Pipeline floor">
        {/* Band labels — the things this organisation actually does. */}
        <g>
          <text x={140} y={30} className={s.bandLabel}>Intake</text>
          <text x={400} y={30} className={s.bandLabel}>Build</text>
          <text x={620} y={30} className={s.bandLabel}>Review</text>
          <text x={820} y={30} className={s.bandLabel}>Ship</text>
        </g>

        {/* Forward handoffs */}
        <g>
          {forwardEdges.map((e) => (
            <path
              key={e.key}
              d={e.d}
              className={`${s.edge} ${e.live ? s.edgeLive : ""}`}
            />
          ))}
        </g>

        {/* The adversarial loop — findings travelling back to their author.
            This is the part no other build tool has to draw. */}
        <g>
          {attackEdges.map((e) => (
            <path
              key={e.key}
              d={e.d}
              className={`${s.attack} ${e.live ? s.attackLive : ""}`}
            />
          ))}
        </g>

        {/* Stations */}
        <g>
          {STATIONS.map((st) => {
            const w = signal.byId.get(st.id);
            const isActive = signal.active.has(st.id);
            const hasErrors = (w?.errors ?? 0) > 0;
            const isSelected = selected === st.id;

            return (
              <g
                key={st.id}
                className={s.station}
                transform={`translate(${st.x}, ${st.y})`}
                onClick={() => onSelect(isSelected ? null : st.id)}
                role="button"
                tabIndex={0}
              >
                {isActive && <circle className={s.pulse} />}
                {/* Generous invisible hit area — the visible mark is small. */}
                <circle r={18} fill="transparent" />
                <circle
                  r={5}
                  className={[
                    s.node,
                    st.band === "attack" ? s.nodeAttack : "",
                    isActive ? s.nodeActive : "",
                    hasErrors ? s.nodeError : "",
                    isSelected ? s.nodeSelected : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
                <text className={s.nodeName} y={26}>{st.id}</text>
                {w && (
                  <text className={s.nodeMeta} y={43}>
                    {hasErrors ? `${w.errors} err · ` : ""}
                    {w.calls} {w.calls === 1 ? "call" : "calls"}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className={s.caption}>
        {signal.attacking
          ? "Reviewers are firing findings back at the code that was just written."
          : signal.active.size > 0
            ? `${signal.active.size} ${signal.active.size === 1 ? "workstream" : "workstreams"} working · ${stage}`
            : "Idle — no workstream has reported in the last few seconds."}
      </div>
    </div>
  );
}
