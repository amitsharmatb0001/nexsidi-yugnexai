// Agent Health Dashboard & Live Workspace WebSocket Routes
// Streams:
// 1. /ws/agents — circuit breaker state, RPM utilisation, pipeline stage per agent.
// 2. /ws/pipeline/:projectId — live terminal tool execution logs + structured events.
//    Two files are tailed concurrently:
//    - pipeline.log  → { type: "log",   content: string }     (raw text, terminal)
//    - events.jsonl  → { type: "event", event: ToolEvent }    (rich cards in UI)

import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { getAllStates, getBucketState, MODEL_RPM_LIMITS } from "@nexsidi/llm-client";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";

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

wsRouter.get(
  "/pipeline/:projectId",
  upgradeWebSocket((c) => {
    const projectId = c.req.param("projectId");
    let interval: ReturnType<typeof setInterval> | null = null;
    let logPosition = 0;
    let eventPosition = 0;

    return {
      onOpen(_, ws) {
        const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
        const logPath   = join(buildDir, projectId, "logs", "pipeline.log");
        const eventsPath = join(buildDir, projectId, "logs", "events.jsonl");

        // Send initial log content
        if (existsSync(logPath)) {
          try {
            const initial = readFileSync(logPath, "utf-8");
            ws.send(JSON.stringify({ type: "log", content: initial }));
            logPosition = initial.length;
          } catch {}
        }

        // Replay past events so UI is current on connect/reconnect
        if (existsSync(eventsPath)) {
          try {
            const raw = readFileSync(eventsPath, "utf-8");
            for (const line of raw.split("\n").filter(Boolean)) {
              try {
                ws.send(JSON.stringify({ type: "event", event: JSON.parse(line) }));
              } catch {}
            }
            eventPosition = raw.length;
          } catch {}
        }

        // Tail both files every 250ms — fast enough to feel real-time
        interval = setInterval(() => {
          // Tail pipeline.log for raw text
          if (existsSync(logPath)) {
            try {
              const stat = statSync(logPath);
              if (stat.size > logPosition) {
                const text = readFileSync(logPath, "utf-8").slice(logPosition);
                ws.send(JSON.stringify({ type: "log", content: text }));
                logPosition = stat.size;
              }
            } catch {}
          }

          // Tail events.jsonl for structured events
          if (existsSync(eventsPath)) {
            try {
              const stat = statSync(eventsPath);
              if (stat.size > eventPosition) {
                const newLines = readFileSync(eventsPath, "utf-8").slice(eventPosition);
                for (const line of newLines.split("\n").filter(Boolean)) {
                  try {
                    ws.send(JSON.stringify({ type: "event", event: JSON.parse(line) }));
                  } catch {}
                }
                eventPosition = stat.size;
              }
            } catch {}
          }
        }, 250);
      },
      onClose() {
        if (interval) clearInterval(interval);
      },
    };
  }),
);

// Screenshot gallery — serves screenshots stored during QA tier-3 review
// so the build page can show what the QA agent actually saw.
wsRouter.get("/screenshots/:projectId", upgradeWebSocket((c) => {
  const projectId = c.req.param("projectId");
  let sent = 0;
  let interval: ReturnType<typeof setInterval> | null = null;

  return {
    onOpen(_, ws) {
      const { readdirSync, readFileSync, existsSync } = require("fs");
      const screenshotDir = join(
        process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds",
        projectId,
        "screenshots",
      );

      const sendScreenshots = () => {
        if (!existsSync(screenshotDir)) return;
        try {
          const files = readdirSync(screenshotDir)
            .filter((f: string) => f.endsWith(".png"))
            .sort();
          const toSend = files.slice(sent);
          for (const file of toSend) {
            try {
              const buf = readFileSync(join(screenshotDir, file));
              ws.send(JSON.stringify({
                type: "screenshot",
                filename: file,
                dataUrl: `data:image/png;base64,${buf.toString("base64")}`,
              }));
              sent++;
            } catch {}
          }
        } catch {}
      };

      sendScreenshots();
      interval = setInterval(sendScreenshots, 2000);
    },
    onClose() {
      if (interval) clearInterval(interval);
    },
  };
}));
