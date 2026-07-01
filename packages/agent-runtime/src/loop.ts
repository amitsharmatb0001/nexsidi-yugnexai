// Real agentic loop using NIM tool calling.
// Replaces the one-shot agentChat() + parse pattern.
// Agents run until they call task_complete or hit MAX_ITERATIONS.

import { nimChatWithTools, type NimToolDef, type NimMessage } from "@nexsidi/llm-client";
import { execWriteFile, execReadFile, execListFiles, FILE_TOOL_DEFS } from "./tools/file.ts";
import { execRunCommand, COMMAND_TOOL_DEF } from "./tools/command.ts";
import { execHttpRequest, HTTP_TOOL_DEF } from "./tools/http.ts";
import { execDockerCompose, DOCKER_TOOL_DEF } from "./tools/docker.ts";
import type { ModelId } from "@nexsidi/llm-client";

const MAX_ITERATIONS = 40;

export interface AgentRunConfig {
  agentName: string;
  model: ModelId;
  apiKey: string;
  systemPrompt: string;
  initialMessage: string;
  sandboxDir: string;         // all file ops scoped here
  enableDockerTools?: boolean; // Riya only
  enableHttpTools?: boolean;   // Shubham verification
}

export interface AgentRunResult {
  success: boolean;
  summary: string;
  filesWritten: string[];
  iterations: number;
  errors: string[];
}

const TASK_COMPLETE_TOOL: NimToolDef = {
  type: "function",
  function: {
    name: "task_complete",
    description: "Call this when your task is fully done. All files written, all verification passed. Do NOT call this until you have verified the output works (tsc passes, build succeeds, or health check passes).",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "What you built and what verification you ran" },
        files_written: { type: "array", items: { type: "string" }, description: "List of all file paths written" },
        verification_passed: { type: "boolean", description: "True only if tsc/build/health-check actually passed" },
      },
      required: ["summary", "files_written", "verification_passed"],
    },
  },
};

export async function runAgent(config: AgentRunConfig): Promise<AgentRunResult> {
  const tools: NimToolDef[] = [
    ...FILE_TOOL_DEFS,
    COMMAND_TOOL_DEF,
    ...(config.enableHttpTools ? [HTTP_TOOL_DEF] : []),
    ...(config.enableDockerTools ? [DOCKER_TOOL_DEF] : []),
    TASK_COMPLETE_TOOL,
  ];

  const messages: NimMessage[] = [
    { role: "system", content: config.systemPrompt },
    { role: "user", content: config.initialMessage },
  ];

  const filesWritten: string[] = [];
  const errors: string[] = [];
  let iterations = 0;

  console.log(`[${config.agentName}:agent] Starting — model: ${config.model}, maxIter: ${MAX_ITERATIONS}`);

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    console.log(`[${config.agentName}:agent] Iteration ${iterations}`);

    let response;
    try {
      response = await nimChatWithTools(config.model, messages, tools, config.apiKey);
    } catch (err) {
      errors.push(`NIM call failed on iteration ${iterations}: ${String(err)}`);
      // Try to continue — next iteration might succeed after a cooldown
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    const choice = response.choices[0];
    if (!choice) {
      errors.push(`Empty response on iteration ${iterations}`);
      break;
    }

    const assistantMsg: NimMessage = {
      role: "assistant",
      content: choice.message.content ?? null,
      tool_calls: choice.message.tool_calls,
    };
    messages.push(assistantMsg);

    // No tool calls — model is done but didn't call task_complete
    if (!choice.message.tool_calls?.length) {
      if (choice.finish_reason === "stop") {
        console.log(`[${config.agentName}:agent] Model stopped without task_complete — treating as done`);
        return { success: false, summary: choice.message.content ?? "no content", filesWritten, iterations, errors: [...errors, "Agent stopped without calling task_complete"] };
      }
      continue;
    }

    // Execute all tool calls
    const toolResults: NimMessage[] = [];
    for (const call of choice.message.tool_calls) {
      const toolName = call.function.name;
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        toolResults.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ status: "error", summary: "Invalid JSON in tool arguments" }) });
        continue;
      }

      console.log(`[${config.agentName}:agent] Tool call: ${toolName}(${JSON.stringify(args).slice(0, 120)})`);

      let result: Record<string, unknown>;

      switch (toolName) {
        case "write_file": {
          const r = execWriteFile(config.sandboxDir, args as { path: string; content: string });
          if (r.status === "success") filesWritten.push((args as { path: string }).path);
          result = r;
          break;
        }
        case "read_file": {
          result = execReadFile(config.sandboxDir, args as { path: string; offset?: number; limit?: number });
          break;
        }
        case "list_files": {
          result = execListFiles(config.sandboxDir, args as { dir?: string; recursive?: boolean });
          break;
        }
        case "run_command": {
          result = execRunCommand(config.sandboxDir, args as { command: string; timeout_ms?: number });
          break;
        }
        case "http_request": {
          result = await execHttpRequest(args as { method: string; url: string; headers?: Record<string, string>; body?: string; timeout_ms?: number });
          break;
        }
        case "docker_compose": {
          result = execDockerCompose(config.sandboxDir, args as { action: "up" | "down" | "logs" | "ps"; service?: string; timeout_ms?: number });
          break;
        }
        case "task_complete": {
          const a = args as { summary: string; files_written: string[]; verification_passed: boolean };
          console.log(`[${config.agentName}:agent] DONE after ${iterations} iterations. Verified: ${a.verification_passed}`);
          if (!a.verification_passed) {
            errors.push("Agent completed without verification passing");
          }
          return {
            success: a.verification_passed,
            summary: a.summary,
            filesWritten: [...filesWritten, ...(a.files_written ?? [])].filter((v, i, arr) => arr.indexOf(v) === i),
            iterations,
            errors,
          };
        }
        default: {
          result = { status: "error", summary: `Unknown tool: ${toolName}` };
        }
      }

      toolResults.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }

    messages.push(...toolResults);
  }

  return {
    success: false,
    summary: `Max iterations (${MAX_ITERATIONS}) reached without task_complete`,
    filesWritten,
    iterations,
    errors: [...errors, "Max iterations exceeded"],
  };
}
