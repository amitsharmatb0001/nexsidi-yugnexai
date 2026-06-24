// NexSidi Temporal Worker
// Runs all pipeline activities and hosts the projectBuildWorkflow.
// Start with: bun pipeline/worker.ts
//
// For local dev: Temporal server must be running (docker-compose.dev.yml)
// Temporal UI: http://localhost:8088

import { Worker, NativeConnection } from "@temporalio/worker";
import { Connection } from "@temporalio/client";
import * as activities from "./activities/index.ts";

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TASK_QUEUE       = process.env.TEMPORAL_TASK_QUEUE ?? "nexsidi-pipeline";

async function run(): Promise<void> {
  console.log(`[worker] connecting to Temporal at ${TEMPORAL_ADDRESS}`);

  const connection = await NativeConnection.connect({ address: TEMPORAL_ADDRESS });

  const worker = await Worker.create({
    connection,
    namespace:     "default",
    taskQueue:     TASK_QUEUE,
    workflowsPath: new URL("./workflows/project-build.ts", import.meta.url).pathname,
    activities,
    // Tune for long-running LLM calls:
    //   maxConcurrentActivityTaskExecutions: how many activities run in parallel
    //   Adjust based on NIM rate limits (3 parallel × 40 RPM = 120 RPM across 3 models)
    maxConcurrentActivityTaskExecutions: 6,
  });

  console.log(`[worker] running on task queue "${TASK_QUEUE}"`);

  process.on("SIGTERM", () => {
    console.log("[worker] SIGTERM received — shutting down gracefully");
    worker.shutdown();
  });
  process.on("SIGINT", () => {
    console.log("[worker] SIGINT received — shutting down gracefully");
    worker.shutdown();
  });

  await worker.run();
}

run().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
