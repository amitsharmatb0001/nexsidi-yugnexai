// Phase 5 Task 4 (final-bundle/phase5-harness-enforcement-plan.md):
// mechanical 3-strike escalation (Rule 7). Three failures with the SAME
// signature is the caller's cue to inject a forced-pivot message ("stop
// retrying this, change approach fundamentally or call escalate"); a 4th
// failure with the SAME signature despite the pivot message returns
// exhausted:true so the caller can terminate the run and let
// runAgentEscalated fire exactly once with a logged reason.

export interface StrikeResult {
  strikes: number;
  exhausted: boolean;
}

export interface StrikeCounter {
  recordFailure(signature: string): StrikeResult;
  recordSuccess(signature: string): void;
}

export function createStrikeCounter(limit = 3): StrikeCounter {
  const counts = new Map<string, number>();

  return {
    recordFailure(signature) {
      const strikes = (counts.get(signature) ?? 0) + 1;
      counts.set(signature, strikes);
      return { strikes, exhausted: strikes > limit };
    },
    recordSuccess(signature) {
      counts.delete(signature);
    },
  };
}

// Failure signature = normalized (command + first line of stderr) — the
// same underlying failure repeated with a different trailing stack trace or
// noise still collapses to one signature, so real repetition is caught even
// when tool output isn't byte-identical run to run.
export function buildFailureSignature(command: string, stderr: string): string {
  const firstLine = stderr.split("\n")[0] ?? "";
  return `${command} :: ${firstLine}`;
}
