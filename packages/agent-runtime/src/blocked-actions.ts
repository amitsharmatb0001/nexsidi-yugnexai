// Blocked-action detector (approved by Amit, 2 Oct 2026). Ledgerly benchmark
// run 2: the frontend builder hit a refused folder, a refused command and
// denied file access again and again for 42 steps. The three-strikes check
// only catches the SAME command failing, so nothing noticed. This counts
// every refusal: at BLOCKED_NOTICE_AT the agent is told to report and move
// on; at BLOCKED_STOP_AT the run stops (its work so far is saved) and a
// report is filed for Tilotma. A connection failure is not counted — a
// container that is still booting is not a wall.

// Loops type tool results loosely (Record<string, any>), so accept any shape.
type ResultLike = { status?: unknown; summary?: unknown; output?: unknown };

export const BLOCKED_NOTICE_AT = 3;
export const BLOCKED_STOP_AT = 6;

const REFUSED =
  /Path traversal blocked|escapes sandbox|outside your folder|not in the allowlist|Command blocked|Command refused|ERR_ACCESS_DENIED|Access to this API has been restricted|is not allowed — run scripts with node|only for installing packages/i;

export function isBlockedResult(result: ResultLike): boolean {
  if (result.status !== "error") return false;
  return REFUSED.test(String(result.summary ?? "")) || REFUSED.test(String(result.output ?? ""));
}

export class BlockedActionTracker {
  count = 0;
  private pending: string | null = null;

  observe(result: ResultLike): void {
    if (!isBlockedResult(result)) return;
    this.count++;
    if (this.count === BLOCKED_NOTICE_AT) {
      this.pending =
        `BLOCKED: ${this.count} of your actions were refused because they reach outside your own work. ` +
        "Stop trying to get around it. Call report_blocked once (owner, what you need, what you checked), then continue with the rest of your own task.";
    } else if (this.count === BLOCKED_STOP_AT - 1) {
      this.pending =
        "BLOCKED: one more refused action ends this run. Finish your own work and call task_complete, or report_blocked and move on.";
    }
  }

  /** The notice to show after this step, once. */
  takeNotice(): string | null {
    const n = this.pending;
    this.pending = null;
    return n;
  }

  get shouldStop(): boolean {
    return this.count >= BLOCKED_STOP_AT;
  }

  stopSummary(): string {
    return `Stopped: ${this.count} actions were refused for reaching outside this agent's own work. Reported to Tilotma.`;
  }
}
