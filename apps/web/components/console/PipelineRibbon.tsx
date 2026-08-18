"use client";

import s from "./console.module.css";

/**
 * Canonical pipeline stages, in execution order.
 *
 * `match` lists the raw stage strings the workflow actually emits over SSE.
 * They are grouped rather than shown one-per-slot because several distinct
 * internal stages are the same thing to a watching human (the pre-QA and
 * post-QA compile gates are both "Compile"), and because the workflow can
 * revisit a stage on a retry — a ribbon with one slot per emitted value
 * would grow sideways every time something was retried.
 */
export const STAGES: { key: string; label: string; match: string[] }[] = [
  { key: "spec",    label: "Spec",    match: ["spec", "planning", "requirements", "await_spec_approval"] },
  { key: "plan",    label: "Plan",    match: ["plan", "decompose", "architecture"] },
  { key: "build",   label: "Build",   match: ["build", "generation", "generate", "dev"] },
  { key: "compile", label: "Compile", match: ["compile_check", "compile"] },
  { key: "qa",      label: "QA",      match: ["qa", "review", "adversarial"] },
  { key: "deploy",  label: "Deploy",  match: ["deploy", "deliver", "await_deploy_approval"] },
  { key: "done",    label: "Live",    match: ["done", "complete", "delivered"] },
];

/** Index of the canonical stage a raw workflow stage string belongs to, or -1. */
export function stageIndexFor(raw: string): number {
  const needle = (raw || "").toLowerCase();
  // Longest match wins so "compile_check" isn't captured by a shorter alias.
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < STAGES.length; i++) {
    for (const m of STAGES[i]!.match) {
      if (needle === m) return i;
      if (needle.includes(m) && m.length > bestLen) {
        best = i;
        bestLen = m.length;
      }
    }
  }
  return best;
}

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function PipelineRibbon({
  stage,
  failed,
  startedAt,
  now,
}: {
  stage: string;
  failed?: boolean;
  /** When the current stage began, for the live elapsed counter. */
  startedAt?: number | null;
  now: number;
}) {
  const current = stageIndexFor(stage);

  return (
    <div className={s.ribbon}>
      {STAGES.map((st, i) => {
        const isCurrent = i === current;
        const isDone = current >= 0 && i < current;
        const cls = [
          s.stage,
          isDone ? s.stageDone : "",
          isCurrent && !failed ? s.stageCurrent : "",
          isCurrent && failed ? s.stageFail : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <div key={st.key} className={cls}>
            <span className={s.stageLabel}>{st.label}</span>
            <span className={s.stageMeta}>
              {isCurrent
                ? failed
                  ? "needs attention"
                  : startedAt
                    ? formatElapsed(now - startedAt)
                    : "running"
                : isDone
                  ? "done"
                  : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
