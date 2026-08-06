import { spawn } from "child_process";
import type { NimToolDef } from "@nexsidi/llm-client";
import type { ToolResult } from "./file.ts";
import { truncateOutput } from "./command.ts";
import { buildSandboxEnv } from "./sandbox-env.ts";

// 2026-08-06: real bug found live (project d749afe43d9c) — this used
// spawnSync, which blocks Node's ENTIRE event loop for the full duration of
// the child process. A fresh "docker compose up --build" (image build +
// npm install inside the container) routinely runs past 3 minutes, and
// while blocked, the calling activity's setInterval heartbeat (see
// runDeployWithLiveRetest, pipeline/activities/index.ts) cannot fire —
// Node never even gets a turn on the event loop to run the timer callback.
// Temporal's orchestratorAct heartbeatTimeout ("3 minutes",
// project-build.ts) then times out attempt 1 and starts attempt 2 — which
// re-verifies the context-chain handoff against the manifest as it now
// exists on disk, which attempt 1 has since MODIFIED (new Dockerfiles,
// docker-compose.yml) mid-blocking-call. That's a guaranteed hash mismatch
// against the pre-deploy snapshot, which rollbackAndEscalate treats as
// tampering and kills the whole workflow — while attempt 1's blocked
// spawnSync, once docker finally returns, keeps running to completion as an
// orphaned process Temporal no longer knows about. The workflow file
// (project-build.ts line ~32) already documents this exact failure mode
// ("deployAct... execSync blocks the event loop... was removed") for a
// different, already-deleted code path — this tool had the same bug via a
// different one. Async spawn keeps the event loop free so the heartbeat
// interval keeps firing during a long build.
export function execDockerCompose(
  cwd: string,
  args: { action: "up" | "down" | "logs" | "ps"; service?: string; timeout_ms?: number },
): Promise<ToolResult> {
  const timeout = Math.min(args.timeout_ms ?? 300_000, 600_000);
  let cmdArgs: string[];

  switch (args.action) {
    case "up":
      cmdArgs = ["compose", "up", "-d", "--build", "--remove-orphans"];
      break;
    case "down":
      cmdArgs = ["compose", "down", "--remove-orphans"];
      break;
    case "logs":
      cmdArgs = ["compose", "logs", "--tail=100", ...(args.service ? [args.service] : [])];
      break;
    case "ps":
      cmdArgs = ["compose", "ps"];
      break;
  }

  return new Promise<ToolResult>((resolve) => {
    const child = spawn("docker", cmdArgs, {
      cwd,
      env: buildSandboxEnv({ FORCE_COLOR: "0", COMPOSE_PROGRESS: "plain" }),
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeout);

    const finish = (exitCode: number | null) => {
      clearTimeout(timer);
      const truncStdout = truncateOutput(stdout, 1000, 7000);
      const truncStderr = truncateOutput(stderr, 1000, 7000);
      const combined = [truncStdout, truncStderr].filter(Boolean).join("\n").trim();
      const success = !timedOut && exitCode === 0;

      resolve({
        status: success ? "success" : "error",
        summary: success
          ? `docker compose ${args.action} succeeded`
          : `docker compose ${args.action} failed (exit ${timedOut ? "timeout" : exitCode})`,
        output: combined || "(no output)",
        next_actions: success
          ? args.action === "up" ? ["Use http_request to health-check the services"] : []
          : ["Read the logs carefully", "docker_compose logs to see full container output", "Fix docker-compose.yml or Dockerfile"],
      });
    };

    child.on("close", (code) => finish(code));
    child.on("error", () => finish(null));
  });
}

export const DOCKER_TOOL_DEF: NimToolDef = {
  type: "function",
  function: {
    name: "docker_compose",
    description: "Run docker compose commands: up (start all services), down (stop), logs (read container logs), ps (list running containers).",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["up", "down", "logs", "ps"], description: "Docker compose action" },
        service: { type: "string", description: "Optional: specific service name for logs command" },
        timeout_ms: { type: "number", description: "Timeout in ms (default 300000 for up, 30000 for others)" },
      },
      required: ["action"],
    },
  },
};
