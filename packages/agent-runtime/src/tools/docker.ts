import { spawnSync } from "child_process";
import type { NimToolDef } from "@nexsidi/llm-client";
import type { ToolResult } from "./file.ts";
import { truncateOutput } from "./command.ts";

export function execDockerCompose(
  cwd: string,
  args: { action: "up" | "down" | "logs" | "ps"; service?: string; timeout_ms?: number },
): ToolResult {
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

  const result = spawnSync("docker", cmdArgs, {
    cwd,
    encoding: "utf-8",
    timeout,
    env: { ...process.env, FORCE_COLOR: "0", COMPOSE_PROGRESS: "plain" },
  });

  const stdout = truncateOutput(result.stdout ?? "", 1000, 7000);
  const stderr = truncateOutput(result.stderr ?? "", 1000, 7000);
  const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
  const success = result.status === 0;

  return {
    status: success ? "success" : "error",
    summary: success
      ? `docker compose ${args.action} succeeded`
      : `docker compose ${args.action} failed (exit ${result.status ?? "timeout"})`,
    output: combined || "(no output)",
    next_actions: success
      ? args.action === "up" ? ["Use http_request to health-check the services"] : []
      : ["Read the logs carefully", "docker_compose logs to see full container output", "Fix docker-compose.yml or Dockerfile"],
  };
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
