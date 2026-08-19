
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
