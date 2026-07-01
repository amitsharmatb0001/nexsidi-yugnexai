// Nice-to-have #11: Agent Health Dashboard WebSocket
// Streams live: circuit breaker state, RPM utilisation, pipeline stage per agent.
// Security Layer 7: deny-by-default — only connects from localhost in dev,
// requires Clerk JWT in production (enforced by authMiddleware before upgrade).

import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { getAllStates } from "@nexsidi/llm-client";
import { getBucketState, MODEL_RPM_LIMITS } from "@nexsidi/llm-client";

export const wsRouter = new Hono();

wsRouter.get(
  "/agents",
  upgradeWebSocket(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    return {
      onOpen(_, ws) {
        interval = setInterval(() => {
          const circuitStates = getAllStates();
          const rpmState = Object.fromEntries(
            Object.entries(MODEL_RPM_LIMITS).map(([modelId, limit]) => [
              modelId,
              getBucketState(modelId, limit),
            ]),
          );

          ws.send(
            JSON.stringify({
              type: "agent_health",
              ts: Date.now(),
              circuits: circuitStates,
              rpm: rpmState,
            }),
          );
        }, 2000);
      },
      onClose() {
        if (interval) clearInterval(interval);
      },
    };
  }),
);
