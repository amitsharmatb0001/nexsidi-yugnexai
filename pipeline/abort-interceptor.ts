// Runs every activity inside its own Temporal cancellation signal.
//
// Ledgerly benchmark, first run: an activity that hit its time limit kept its
// agent running while Temporal started a retry — two agents wrote the same
// files at once. With this interceptor every agent loop sees its activity's
// signal (packages/agent-runtime/src/run-abort.ts) and stops at the next step
// once the activity is cancelled or times out. Applies to every stage: spec,
// planning, generation, QA, fixes, deploy and live review.
import type { Context as ActivityContext } from "@temporalio/activity";
import type { ActivityInterceptors } from "@temporalio/worker";
import { runWithAbortSignal } from "../packages/agent-runtime/src/run-abort.ts";

export function abortSignalInterceptors(ctx: ActivityContext): ActivityInterceptors {
  return {
    inbound: {
      execute: (input, next) => runWithAbortSignal(ctx.cancellationSignal, () => next(input)),
    },
  };
}
