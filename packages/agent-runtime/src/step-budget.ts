// 2026-09-29: real losses (project a034f90ba50e). Agents hit their step cap
// mid-work with nothing reported: the reality checker was still taking
// "recheck" screenshots at step 61 of 61 (no verdict — the whole review round
// lost), and Aanya's finished design fix hit 40 of 40 while clicking through
// the app, so it counted as failed. No loop ever told an agent its budget was
// nearly spent. Every loop appends this notice after a step's tool results.

export const WRAP_UP_STEPS = 5;

/** The notice to show after step `iteration` of `maxIterations`, or null. */
export function stepBudgetNotice(iteration: number, maxIterations: number): string | null {
  const left = maxIterations - iteration;
  if (left === 1) {
    return "STEP BUDGET: this is your LAST step. Call task_complete now with everything you have established — anything not in task_complete is lost.";
  }
  // 2026-10-02 (Ledgerly benchmark run 2): 5 steps before the end was too
  // late — the frontend builder spent them deleting scratch files.
  if (maxIterations >= 20 && iteration === Math.floor(maxIterations * 0.8)) {
    return `STEP BUDGET: 80% of your ${maxIterations} steps are used. Finish your own task now — no new checks or side work; get the required checks passing and call task_complete.`;
  }
  if (left === WRAP_UP_STEPS && maxIterations > WRAP_UP_STEPS) {
    return `STEP BUDGET: ${WRAP_UP_STEPS} steps left of ${maxIterations}. Stop exploring and re-checking; use what you have and call task_complete within the next steps — work that is not reported in task_complete is lost.`;
  }
  return null;
}

// 2026-10-02 (Part C.3, approved by Amit): no fixed step count for phased
// builders. When a run reaches its budget it keeps going only while it is
// making progress — a file written or a required check passing within the
// recent window — and is extended by that window each time. An agent going
// in circles is not extended (the stuck and blocked detectors stop it even
// sooner). The run's own time limit is the only outer bound.
export class StepBudget {
  max: number;
  private readonly initial: number;
  private lastProgress = -1;

  constructor(max: number, private readonly extendWhileProgressing: boolean) {
    this.max = max;
    this.initial = max;
  }

  noteProgress(iteration: number): void {
    this.lastProgress = Math.max(this.lastProgress, iteration);
  }

  private get window(): number {
    return Math.max(10, Math.round(this.initial * 0.25));
  }

  canContinue(iterations: number): boolean {
    if (iterations < this.max) return true;
    if (!this.extendWhileProgressing) return false;
    if (this.lastProgress >= 0 && this.lastProgress >= iterations - this.window) {
      this.max += this.window;
      console.log(`[step-budget] still making progress at step ${iterations} — extended to ${this.max} steps`);
      return true;
    }
    return false;
  }
}

const WRITE_TOOLS = new Set(["write_file", "write_files", "edit_file", "delete_file"]);

/** A step that moved the work forward: a file written, or a required check passing. */
export function isProgressStep(
  toolName: string,
  result: { status?: unknown },
  args: unknown,
  requiredCommands: string[] = [],
): boolean {
  if (result.status !== "success") return false;
  if (WRITE_TOOLS.has(toolName)) return true;
  if (toolName === "run_command") {
    const command = String((args as { command?: unknown })?.command ?? "").trim().replace(/\s+/g, " ");
    return requiredCommands.some((c) => c.trim().replace(/\s+/g, " ") === command);
  }
  return false;
}
