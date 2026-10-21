// Gives a review agent what reviewers like it have missed before (patent claim 4: the adversarial example database feeds the
// next review). The examples come from training rounds (scripts/train-checkers.ts) in which known defects were planted in
// copies of real code and the agent did not report them. Never fatal: with no database or no examples the agent's input is
// unchanged.
import { formatMissedForPrompt, type AdversarialExample } from "../../../packages/agent-runtime/src/training/trainer.ts";

export interface MissedSource {
  missedFor(checker: string, maxLevel: number, limit: number): Promise<unknown[]>;
}

export async function missedExamplesFor(checker: string, deps: { store?: MissedSource; limit?: number; timeoutMs?: number } = {}): Promise<string> {
  try {
    const store = deps.store ?? (await import("@nexsidi/db")).createTrainingStore();
    // A database that does not answer must not hold up a review.
    const rows = (await Promise.race([
      store.missedFor(checker, 5, deps.limit ?? 5),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), deps.timeoutMs ?? 3000).unref?.()),
    ])) as AdversarialExample[];
    return formatMissedForPrompt(rows, deps.limit ?? 5);
  } catch {
    return "";
  }
}
