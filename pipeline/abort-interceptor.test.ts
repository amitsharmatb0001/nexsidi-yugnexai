import { test, expect } from "bun:test";
import { abortSignalInterceptors } from "./abort-interceptor.ts";
import { currentAbortSignal } from "../packages/agent-runtime/src/run-abort.ts";

// Every activity — spec, planning, generation, QA, fixes, deploy, live review —
// runs inside its own Temporal cancellation signal, so an agent stops at its
// next step when its activity is cancelled or times out.
test("an activity runs inside its own cancellation signal", async () => {
  const controller = new AbortController();
  const interceptors = abortSignalInterceptors({ cancellationSignal: controller.signal } as never);
  let seen: AbortSignal | undefined;
  await interceptors.inbound!.execute!({ args: [], headers: {} }, async () => { seen = currentAbortSignal(); return "done"; });
  expect(seen).toBe(controller.signal);
});
