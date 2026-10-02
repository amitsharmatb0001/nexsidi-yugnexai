// Stopping and checkpointing agent runs.
//
// Ledgerly benchmark, first run: the frontend generation step hit its time
// limit, but the agent kept running while Temporal started a retry — two
// frontend agents wrote the same files at once — and the retry started from
// step 1 because history was saved only when an agent finished.
//
// The worker runs every activity inside runWithAbortSignal(ctx.cancellationSignal,
// …) (pipeline/abort-interceptor.ts); every agent loop checks runStopReason()
// at the top of each step and stops when the run was cancelled or timed out.
// Every loop saves its history after EVERY step, in every stage, so nothing is
// lost on a hard kill and a retry resumes from the saved conversation.
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<AbortSignal>();

export function runWithAbortSignal<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  return store.run(signal, fn);
}

export function currentAbortSignal(): AbortSignal | undefined {
  return store.getStore();
}

/** Why this run must stop now, or null to carry on. */
export function runStopReason(config?: { abortSignal?: AbortSignal }): string | null {
  const signal = config?.abortSignal ?? currentAbortSignal();
  if (!signal?.aborted) return null;
  const reason = signal.reason instanceof Error ? signal.reason.message : String(signal.reason ?? "cancelled");
  return `Stopped: the step was cancelled or timed out (${reason}) — progress saved for a retry`;
}
